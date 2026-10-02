const test = require('node:test')
const assert = require('node:assert/strict')

const Ledger = require('../OperationLedger.js')
const Coordinator = require('../RequestCoordinator.js')
const Store = require('../LedgerStoreModel.js')
const Contract = require('../CanonicalContract.js')
const Model = require('../TimeTrackingModel.js')
const { createServiceRuntime } = require('../ServiceRuntime.js')

const budgets = { read: 64000, 'single-write': 128000, 'multi-segment': 320000, log: 192000, switch: 320000 }
const tokenA = 'a'.repeat(64)
const tokenB = 'b'.repeat(64)

function entry(id = '9', overrides = {}) {
  return {
    contractVersion: 2, kind: 'time-entry', id, exists: true,
    localDate: '2026-09-02', startedAt: '2026-09-02T17:00:00.000Z',
    durationSeconds: 3600, projectId: '44', clientId: '55', serviceId: '66',
    note: 'Planning', billable: true, billed: false, token: tokenA, ...overrides
  }
}

function timer(id = 'timer-1', overrides = {}) {
  return {
    contractVersion: 2, kind: 'active-timer', id, exists: true,
    segments: [{ contractVersion: 2, kind: 'timer-segment', id: `segment-${id}`, timerId: id, exists: true,
      startedAt: '2026-09-02T17:00:00.000Z', durationSeconds: null, running: true, logged: false, token: '1'.repeat(64) }],
    state: 'running', elapsedAnchor: { closedSeconds: 0, runningStartedAt: '2026-09-02T17:00:00.000Z', observedAt: '2026-09-02T17:30:00.000Z' },
    projectId: '44', clientId: '55', serviceId: '66', note: 'Planning', billable: true, token: tokenA,
    ...overrides
  }
}

function runtime(records = []) {
  const instance = createServiceRuntime({ Ledger, Coordinator, budgets })
  instance.startup({ schemaVersion: 1, operations: [], records: Object.fromEntries(records.map(record => [`${record.kind}:${record.id}`, record])) })
  return instance
}

function updateIntent(overrides = {}) {
  const base = entry()
  return {
    type: 'save-entry', scope: 'time-entry:9', base, baseToken: base.token, baseContractVersion: 2,
    patch: { note: 'Changed locally' }, intended: entry('9', { note: 'Changed locally', token: tokenB }),
    draft: { note: 'Changed locally' }, argv: ['time', 'update', '9', '--note', 'Changed locally', '--guard', tokenA],
    commandClass: 'single-write', ...overrides
  }
}

function receipt(kind, before, after, scope) {
  return {
    contractVersion: 2, mutationKind: kind,
    changes: [{ scope, before: before ? { token: before.token } : { absent: true }, after: after && after.exists !== false ? { record: after } : { deleted: true } }],
    results: [after], phase: null
  }
}

function persistThenStart(instance, intent) {
  assert.equal(instance.submitIntent(intent), true)
  const persistence = instance.takeActions()
  assert.deepEqual(persistence.map(action => action.type), ['persist'])
  instance.storeSaved(persistence[0].transactionId)
  const starts = instance.takeActions()
  assert.deepEqual(starts.map(action => action.type), ['start'])
  const request = starts[0].request
  instance.adapterStarted(request.requestId)
  const startedPersistence = instance.takeActions()
  assert.deepEqual(startedPersistence.map(action => action.type), ['persist'])
  instance.storeSaved(startedPersistence[0].transactionId)
  assert.deepEqual(instance.takeActions(), [])
  return request
}

function settle(instance, request, data) {
  instance.adapterCompleted({ ...request, outcome: 'receipt', data })
  const persistence = instance.takeActions()
  assert.deepEqual(persistence.map(action => action.type), ['persist'])
  instance.storeSaved(persistence[0].transactionId)
  assert.deepEqual(instance.takeActions(), [])
}

test('accepted save publishes optimistic view before adapter start', () => {
  const service = runtime([entry()])
  assert.equal(service.submitIntent(updateIntent()), true)
  assert.equal(service.getView().records['time-entry:9'].note, 'Changed locally')
  assert.deepEqual(service.takeActions().map(action => action.type), ['persist'])
})

test('store save gates mutation dispatch', () => {
  const service = runtime([entry()])
  service.submitIntent(updateIntent())
  const [save] = service.takeActions()
  assert.equal(save.type, 'persist')
  assert.deepEqual(service.takeActions(), [])
  service.storeSaved(save.transactionId)
  assert.equal(service.takeActions()[0].type, 'start')
})

test('every timer intent is canonical and serializable before dispatch', () => {
  const now = '2026-09-02T17:30:30.000Z'
  const base = timer()
  const cases = [
    ['pause', base, {}, { 'timer-state': { state: 'paused' } }],
    ['resume', Model.projectTimerIntent('pause', base, {}, now), {}, { 'timer-state': { state: 'running' } }],
    ['correct-duration', base, { durationSeconds: 300 }, { duration: 300 }],
    ['update-note', base, { note: 'Changed' }, { note: 'Changed' }],
    ['log', base, {}, { 'timer-state': { state: 'logged' } }],
    ['discard', base, {}, { 'timer-state': { state: 'deleted' } }]
  ]
  for (const [type, current, values, patch] of cases) {
    const service = runtime([current])
    const intended = Model.projectTimerIntent(type, current, values, now)
    assert.equal(service.submitIntent({
      type, scope: `active-timer:${current.id}`, base: current, baseToken: current.token,
      intended, patch, draft: values, argv: ['timer', type, '--id', current.id],
      commandClass: type === 'log' ? 'log' : 'multi-segment'
    }), true)
    const [save] = service.takeActions()
    assert.doesNotThrow(() => Store.serialize(save.snapshot), type)
    assert.deepEqual(service.takeActions(), [])
    service.storeSaved(save.transactionId)
    assert.deepEqual(service.takeActions().map(action => action.type), ['start'])
  }

  for (const type of ['start', 'switch']) {
    const service = runtime(type === 'switch' ? [base] : [])
    const intended = Model.projectTimerIntent(type, type === 'switch' ? base : null, {
      projectId: '77', serviceId: '88', note: 'Next'
    }, now)
    assert.equal(service.submitIntent({
      type, scope: null, base: type === 'switch' ? base : null,
      baseToken: type === 'switch' ? base.token : null, intended,
      patch: { assignment: { projectId: '77', serviceId: '88' }, note: 'Next' },
      draft: { projectId: '77', serviceId: '88', note: 'Next' },
      argv: ['timer', type, '--project', '77'],
      commandClass: type === 'switch' ? 'switch' : 'multi-segment'
    }), true)
    const [save] = service.takeActions()
    const restored = Store.deserialize(Store.serialize(save.snapshot))
    assert.equal(restored.recoveryError, null, type)
    assert.equal(restored.snapshot.operations[0].intended.segments.length, 1, type)
    assert.deepEqual(service.takeActions(), [])
  }
})

test('running timer resume is rejected before persistence or dispatch', () => {
  const current = timer()
  const intended = Model.projectTimerIntent('resume', current, {}, '2026-09-02T17:30:30.000Z')
  const serialized = Store.serialize({
    schemaVersion: 1,
    operations: [],
    records: { 'active-timer:timer-1': intended }
  })
  assert.equal(Store.deserialize(serialized).recoveryError, null)
  assert.equal(intended.segments.length, 1)

  const service = runtime([current])
  assert.equal(service.submitIntent({
    type: 'resume', scope: 'active-timer:timer-1', base: current, baseToken: current.token,
    intended, patch: { 'timer-state': { state: 'running' } }, draft: {},
    argv: ['timer', 'resume', '--id', current.id], commandClass: 'multi-segment'
  }), false)
  assert.deepEqual(service.takeActions(), [])
  assert.equal(service.getView().operations.length, 0)
})

test('mutation remains locked until ledger startup completes', () => {
  const service = createServiceRuntime({ Ledger, Coordinator, budgets })
  assert.equal(service.submitIntent(updateIntent()), false)
  assert.deepEqual(service.takeActions(), [])

  const unread = '{"schemaVersion":99,"operations":[SENSITIVE BYTES'
  const loaded = Store.deserialize(unread)
  service.startup(loaded.snapshot, loaded.recoveryError)

  assert.equal(loaded.unreadText, unread)
  assert.equal(service.submitIntent(updateIntent()), false)
  assert.deepEqual(service.takeActions(), [])
  assert.equal(service.getView().errors.at(-1).code, 'LEDGER_CORRUPT')
})

test('corrupt and unsupported ledger recovery locks mutations without replacing unread bytes', () => {
  const cases = [
    ['{"schemaVersion":99,"operations":[SENSITIVE BYTES', 'LEDGER_CORRUPT'],
    [JSON.stringify({ schemaVersion: 99, operations: [], records: {} }), 'LEDGER_SCHEMA_UNSUPPORTED']
  ]
  for (const [unread, code] of cases) {
    const loaded = Store.deserialize(unread)
    assert.equal(loaded.unreadText, unread)
    const service = createServiceRuntime({ Ledger, Coordinator, budgets })
    service.startup(loaded.snapshot, loaded.recoveryError)

    assert.equal(service.submitIntent(updateIntent()), false)
    assert.deepEqual(service.takeActions(), [])
    assert.equal(service.getView().errors.at(-1).code, code)
  }
})

test('restored prepared mutation becomes durable unknown before reconciliation', () => {
  const service = runtime([entry()])
  assert.equal(service.submitIntent(updateIntent()), true)
  const prepared = service.takeActions()[0].snapshot
  const restarted = createServiceRuntime({ Ledger, Coordinator, budgets })

  restarted.startup(Store.deserialize(Store.serialize(prepared)).snapshot)

  assert.equal(restarted.getView().operations[0].state, 'unknown')
  assert.equal(restarted.getView().records['time-entry:9'].note, 'Changed locally')
  assert.equal(restarted.getView().actions['time-entry:9'].canMutate, false)
  const [save] = restarted.takeActions()
  assert.equal(save.type, 'persist')
  assert.equal(save.snapshot.operations[0].state, 'unknown')
  assert.deepEqual(restarted.takeActions(), [])
  restarted.storeSaved(save.transactionId)
  const [read] = restarted.takeActions()
  assert.equal(read.type, 'start')
  assert.equal(read.request.requestKind, 'reconciliation')
  assert.equal(read.request.argv[0], 'time')
})

test('partial CLI writes classify as unknown and enter ledger reconciliation', () => {
  const service = runtime([entry()])
  const request = persistThenStart(service, updateIntent())
  const completion = Contract.classifyProcessOutcome(request, {
    exitCode: 1,
    exitStatus: 0,
    stderr: JSON.stringify({
      schemaVersion: 1,
      ok: false,
      error: {
        code: 'MUTATION_OUTCOME_UNKNOWN',
        message: 'FreshBooks accepted part of the mutation',
        outcomeUnknown: true,
        details: { mutationKind: 'timer-update' }
      }
    })
  })
  assert.equal(completion.outcome, 'unknown')
  service.adapterCompleted(completion)
  const [save] = service.takeActions()
  assert.equal(save.snapshot.operations[0].state, 'unknown')
  assert.equal(service.getView().operations[0].state, 'unknown')
  assert.equal(service.getView().records['time-entry:9'].note, 'Changed locally')
  service.storeSaved(save.transactionId)
  assert.equal(service.takeActions()[0].request.requestKind, 'reconciliation')
})

test('concurrent accepted intents serialize ledger store writes', () => {
  const service = runtime([entry(), entry('10')])
  assert.equal(service.submitIntent(updateIntent()), true)
  assert.equal(service.submitIntent(updateIntent({
    scope: 'time-entry:10',
    base: entry('10'),
    intended: entry('10', { note: 'Also changed', token: tokenB }),
    patch: { note: 'Also changed' },
    argv: ['time', 'update', '10']
  })), true)
  const first = service.takeActions()
  assert.deepEqual(first.map(action => action.type), ['persist'])
  service.storeSaved(first[0].transactionId)
  assert.deepEqual(service.takeActions().map(action => action.type).sort(), ['persist', 'start'])
})

test('receipt settles without read', () => {
  const service = runtime([entry()])
  const request = persistThenStart(service, updateIntent())
  const changed = entry('9', { note: 'Changed locally', token: tokenB })
  settle(service, request, receipt('time-entry-update', entry(), changed, 'time-entry:9'))
  assert.equal(service.getView().operations[0].state, 'settled')
  assert.equal(service.getView().records['time-entry:9'].token, tokenB)
})

test('guard rejection rebases once', () => {
  const service = runtime([entry()])
  const request = persistThenStart(service, updateIntent())
  const current = entry('9', { durationSeconds: 7200, token: 'c'.repeat(64) })
  service.adapterCompleted({ ...request, outcome: 'known-error', error: {
    code: 'GUARD_REJECTED', details: { contractVersion: 2, identity: { kind: 'time-entry', id: '9' }, expectedToken: tokenA, currentToken: current.token, current }
  } })
  const [save] = service.takeActions()
  assert.equal(save.type, 'persist')
  service.storeSaved(save.transactionId)
  const starts = service.takeActions().filter(action => action.type === 'start')
  assert.equal(starts.length, 1)
  assert.equal(starts[0].request.argv.filter(value => value === '--guard').length, 1)
  assert.equal(service.getView().operations.filter(operation => operation.state === 'prepared').length, 1)
})

test('persist-only conflict resolutions are accepted', () => {
  function conflictedService() {
    const service = runtime([entry()])
    const request = persistThenStart(service, updateIntent())
    const current = entry('9', { note: 'Changed remotely', token: 'c'.repeat(64) })
    service.adapterCompleted({ ...request, outcome: 'known-error', error: {
      code: 'GUARD_REJECTED', message: 'changed', details: {
        contractVersion: 2, identity: { kind: 'time-entry', id: '9' },
        expectedToken: tokenA, currentToken: current.token, current
      }
    } })
    const [conflictSave] = service.takeActions()
    service.storeSaved(conflictSave.transactionId)
    service.takeActions()
    return service
  }

  const discarded = conflictedService()
  assert.equal(discarded.submitIntent({ type: 'discard-local', operationId: 'operation-1' }), true)
  assert.deepEqual(discarded.takeActions().map(action => action.type), ['persist'])

  const chosen = conflictedService()
  assert.equal(chosen.submitIntent({
    type: 'choose-freshbooks', operationId: 'operation-1', group: 'note'
  }), true)
  assert.deepEqual(chosen.takeActions().map(action => action.type), ['persist'])
})

test('partial switch preserves logged result', () => {
  const base = timer()
  const target = timer('target', { projectId: '77', token: tokenB })
  const service = runtime([base])
  const request = persistThenStart(service, {
    type: 'switch', scope: null, base, baseToken: base.token, intended: target,
    patch: { assignment: { projectId: '77' } }, draft: { projectId: '77' },
    argv: ['timer', 'switch', '--project', '77', '--guard', tokenA], commandClass: 'switch'
  })
  assert.match(request.scope, /^provisional:operation-\d+:timer-switch-target$/)
  const logged = entry('20', { token: 'c'.repeat(64) })
  const oldDeleted = { contractVersion: 2, kind: 'active-timer', id: base.id, exists: false, token: null }
  const partialReceipt = {
    contractVersion: 2, mutationKind: 'timer-switch',
    changes: [
      { scope: 'time-entry:20', before: { absent: true }, after: { record: logged } },
      { scope: 'active-timer:timer-1', before: { token: tokenA }, after: { deleted: true } }
    ],
    results: [logged, oldDeleted], phase: { log: 'confirmed', start: 'failed' }
  }
  const completion = Contract.classifyProcessOutcome(request, {
    exitCode: 1,
    exitStatus: 0,
    stderr: JSON.stringify({ schemaVersion: 1, ok: false, error: {
      code: 'TIMER_SWITCH_PARTIAL',
      message: 'Logged but did not start',
      details: {
        partialReceipt,
        startError: { code: 'START_FAILED', message: 'failed' }
      }
    } })
  })
  assert.equal(completion.outcome, 'known-error')
  service.adapterCompleted(completion)
  const actions = service.takeActions()
  assert.deepEqual(actions.map(action => action.type), ['persist'])
  assert.equal(actions[0].snapshot.operations.at(-1).receipt.phase.start, 'failed')
  const durablePartial = Store.deserialize(Store.serialize(actions[0].snapshot)).snapshot
  const incompletePartial = structuredClone(actions[0].snapshot)
  incompletePartial.operations.at(-1).receipt.changes =
    incompletePartial.operations.at(-1).receipt.changes.filter(change => change.scope !== 'time-entry:20')
  incompletePartial.operations.at(-1).receipt.results =
    incompletePartial.operations.at(-1).receipt.results.filter(record => record.kind !== 'time-entry')
  assert.throws(() => Store.serialize(incompletePartial), /invalid durable ledger snapshot/)
  const beforeAcknowledgment = createServiceRuntime({ Ledger, Coordinator, budgets })
  beforeAcknowledgment.startup(durablePartial)
  assert.equal(beforeAcknowledgment.getView().records['time-entry:20'].id, '20')
  assert.equal(beforeAcknowledgment.getView().operations.at(-1).state, 'unknown')
  assert.equal(beforeAcknowledgment.takeActions()[0].type, 'start')
  service.storeSaved(actions[0].transactionId)
  const afterAcknowledgment = service.takeActions()
  assert.equal(afterAcknowledgment.some(action => action.type === 'start'
    && action.request.requestKind === 'reconciliation'), true)
  assert.equal(service.getView().records['time-entry:20'].id, '20')
  assert.equal(service.getView().operations.at(-1).state, 'unknown')
  const afterRestart = createServiceRuntime({ Ledger, Coordinator, budgets })
  afterRestart.startup(durablePartial)
  assert.equal(afterRestart.getView().records['time-entry:20'].id, '20')
  assert.equal(afterRestart.getView().operations.at(-1).state, 'unknown')
})

test('unknown blocks only affected scope and queues reconciliation', () => {
  const service = runtime([entry(), entry('10')])
  const request = persistThenStart(service, updateIntent())
  service.adapterCompleted({ ...request, outcome: 'unknown', error: { code: 'INVALID_RESPONSE' } })
  const [save] = service.takeActions()
  service.storeSaved(save.transactionId)
  const actions = service.takeActions()
  assert.equal(actions.some(action => action.type === 'start' && action.request.requestKind === 'reconciliation'), true)
  assert.equal(service.getView().actions['time-entry:9'].canMutate, false)
  assert.equal(service.getView().actions['time-entry:10'].canMutate, true)
})

test('restart loads ledger before ordinary refresh', () => {
  const first = runtime([entry()])
  const request = persistThenStart(first, updateIntent())
  first.adapterCompleted({ ...request, outcome: 'unknown', error: { code: 'TIMEOUT' } })
  const [unknownSave] = first.takeActions()
  const restarted = createServiceRuntime({ Ledger, Coordinator, budgets })
  restarted.startup(unknownSave.snapshot)
  assert.equal(restarted.getView().records['time-entry:9'].note, 'Changed locally')
  assert.equal(restarted.getView().operations[0].state, 'unknown')
  assert.deepEqual(restarted.takeActions().map(action => action.type), ['start'])
})

test('quiet refreshes coalesce', () => {
  const service = runtime([entry()])
  assert.equal(service.submitIntent({ type: 'refresh', requestKind: 'quiet-read', queryKey: 'recent', coverage: null, argv: ['time', 'list'] }), true)
  assert.equal(service.submitIntent({ type: 'refresh', requestKind: 'quiet-read', queryKey: 'recent', coverage: null, argv: ['time', 'list'] }), true)
  const actions = service.takeActions()
  assert.equal(actions.filter(action => action.type === 'start').length, 1)
})

test('runtime mediates metadata, accepts active coalesced reads, and rejects canceled deliveries', () => {
  const service = runtime()
  service.submitIntent({
    type: 'refresh', requestKind: 'quiet-read', queryKey: 'projects',
    responseKind: 'project-list', argv: ['projects', 'list']
  })
  let [start] = service.takeActions()
  service.adapterStarted(start.request.requestId)
  const accepted = service.adapterCompleted({
    ...start.request, outcome: 'observation', data: [{ id: 44, title: 'Build' }]
  })
  assert.deepEqual(accepted, {
    responseKind: 'project-list',
    queryKey: 'projects',
    outcome: 'observation',
    data: [{ id: 44, title: 'Build' }]
  })
  assert.deepEqual(service.getView().projects, [{ id: 44, title: 'Build' }])
  assert.equal(Object.isFrozen(service.getView().projects), true)
  assert.equal(Object.isFrozen(service.getView().projects[0]), true)

  service.submitIntent({
    type: 'refresh', requestKind: 'quiet-read', queryKey: 'businesses',
    responseKind: 'business-list', argv: ['business', 'list']
  })
  ;[start] = service.takeActions()
  service.adapterStarted(start.request.requestId)
  service.submitIntent({
    type: 'refresh', requestKind: 'quiet-read', queryKey: 'businesses',
    responseKind: 'business-list', argv: ['business', 'list']
  })
  const coalesced = service.adapterCompleted({
    ...start.request, outcome: 'observation', data: [{ id: 1, name: 'Current' }]
  })
  assert.deepEqual(coalesced, {
    responseKind: 'business-list',
    queryKey: 'businesses',
    outcome: 'observation',
    data: [{ id: 1, name: 'Current' }]
  })
  assert.equal(service.takeActions().some(action => action.type === 'start'), false)

  const cancelService = runtime([entry()])
  cancelService.submitIntent({
    type: 'refresh', requestKind: 'quiet-read', queryKey: 'projects',
    responseKind: 'project-list', argv: ['projects', 'list']
  })
  const [readStart] = cancelService.takeActions()
  cancelService.adapterStarted(readStart.request.requestId)
  cancelService.submitIntent(updateIntent())
  const [save] = cancelService.takeActions()
  cancelService.storeSaved(save.transactionId)
  assert.equal(cancelService.takeActions()[0].type, 'cancel-read')
  assert.equal(cancelService.adapterCompleted({
    ...readStart.request, outcome: 'observation', canceled: true,
    data: [{ id: 44, title: 'late' }]
  }), null)
})

test('retained metadata and onboarding commands validate through the runtime', () => {
  const cases = [
    ['project-list', ['projects', 'list'], [{
      id: 44, title: 'Build', clientId: 55, clientName: 'Acme', active: true,
      complete: false, internal: false,
      services: [{ id: 66, name: 'Development', billable: true }]
    }]],
    ['business-list', ['business', 'list'],
      [{ id: 123, name: 'Acme', accountId: 'abc', role: 'owner', active: true }]],
    ['business-selection', ['business', 'use', '123'],
      { id: 123, name: 'Acme', accountId: 'abc', role: 'owner', active: true }],
    ['auth-configured', ['auth', 'configure'], {
      configured: true, clientId: 'client', redirectUri: 'https://localhost/callback',
      profile: 'default', credentialStore: 'secret-service', warning: null
    }],
    ['auth-url', ['auth', 'url'], { url: 'https://auth.example/authorize?state=opaque' }],
    ['auth-login', ['auth', 'login'], {
      authenticated: true, expiresAt: '2026-10-01T12:00:00.000Z',
      scope: 'user:profile:read', credentialStore: 'secret-service', warning: null
    }],
    ['diagnostics', ['diagnostics', 'status'], {
      version: '0.3.0', configured: true, authenticated: true, businessSelected: true,
      timezone: 'America/Chicago', localDate: '2026-10-01', canonicalContractVersion: 2,
      commandBudgetsMs: { read: 64000, singleWrite: 128000, multiSegment: 320000, log: 192000, switch: 320000 },
      capabilities: ['semantic-guards', 'canonical-tracking-v2', 'mutation-receipts']
    }]
  ]
  for (const [responseKind, argv, data] of cases) {
    const service = runtime()
    service.submitIntent({
      type: 'refresh', requestKind: 'visible-read', queryKey: responseKind,
      responseKind, argv
    })
    const [start] = service.takeActions()
    service.adapterStarted(start.request.requestId)
    const completion = Contract.classifyProcessOutcome(start.request, {
      exitCode: 0,
      exitStatus: 0,
      stdout: JSON.stringify({ schemaVersion: 1, ok: true, data })
    })
    assert.equal(completion.outcome, 'observation', responseKind)
    assert.deepEqual(service.adapterCompleted(completion), {
      responseKind, queryKey: responseKind, outcome: 'observation', data
    })
  }
})

test('all time entry and active timer intents route receipt conflict and unknown outcomes', async t => {
  const baseEntry = entry()
  const baseTimer = timer()
  const pausedTimer = timer('timer-1', {
    state: 'paused',
    segments: timer().segments.map(segment => ({ ...segment, running: false, durationSeconds: 1800 })),
    elapsedAnchor: { closedSeconds: 1800, runningStartedAt: null, observedAt: '2026-09-02T17:30:00.000Z' }
  })
  const correctedTimer = timer('timer-1', {
    elapsedAnchor: { closedSeconds: 1800, runningStartedAt: '2026-09-02T17:00:00.000Z', observedAt: '2026-09-02T17:30:00.000Z' },
    token: tokenB
  })
  const deletedEntry = { contractVersion: 2, kind: 'time-entry', id: '9', exists: false, token: null }
  const deletedTimer = { contractVersion: 2, kind: 'active-timer', id: 'timer-1', exists: false, token: null }
  const cases = [
    ['create', [], { type: 'save-entry', scope: null, base: null, intended: entry('new', { token: tokenB }), patch: { note: 'Planning' }, draft: {}, argv: ['time', 'create'], commandClass: 'single-write' }, 'time-entry-create', entry('new', { token: tokenB })],
    ['update', [baseEntry], updateIntent(), 'time-entry-update', entry('9', { note: 'Changed locally', token: tokenB })],
    ['delete', [baseEntry], { type: 'save-entry', scope: 'time-entry:9', base: baseEntry, baseToken: tokenA, intended: deletedEntry, patch: { 'timer-state': { state: 'deleted' } }, draft: {}, argv: ['time', 'delete', '9'], commandClass: 'single-write' }, 'time-entry-delete', deletedEntry],
    ['start', [], { type: 'start', scope: null, base: null, intended: timer('new', { token: tokenB }), patch: { 'timer-state': { state: 'running' } }, draft: {}, argv: ['timer', 'start'], commandClass: 'multi-segment' }, 'timer-start', timer('new', { token: tokenB })],
    ['pause', [baseTimer], { type: 'pause', scope: 'active-timer:timer-1', base: baseTimer, baseToken: tokenA, intended: { ...pausedTimer, token: tokenB }, patch: { 'timer-state': { state: 'paused' } }, draft: {}, argv: ['timer', 'pause'], commandClass: 'multi-segment' }, 'timer-pause', { ...pausedTimer, token: tokenB }],
    ['resume', [pausedTimer], { type: 'resume', scope: 'active-timer:timer-1', base: pausedTimer, baseToken: tokenA, intended: timer('timer-1', { token: tokenB }), patch: { 'timer-state': { state: 'running' } }, draft: {}, argv: ['timer', 'resume'], commandClass: 'multi-segment' }, 'timer-resume', timer('timer-1', { token: tokenB })],
    ['correct', [baseTimer], { type: 'correct-duration', scope: 'active-timer:timer-1', base: baseTimer, baseToken: tokenA, intended: correctedTimer, patch: { duration: 1800 }, draft: {}, argv: ['timer', 'correct'], commandClass: 'multi-segment' }, 'timer-correct', correctedTimer],
    ['note', [baseTimer], { type: 'update-note', scope: 'active-timer:timer-1', base: baseTimer, baseToken: tokenA, intended: timer('timer-1', { note: 'New', token: tokenB }), patch: { note: 'New' }, draft: {}, argv: ['timer', 'update'], commandClass: 'multi-segment' }, 'timer-update', timer('timer-1', { note: 'New', token: tokenB })],
    ['log', [baseTimer], { type: 'log', scope: 'active-timer:timer-1', base: baseTimer, baseToken: tokenA, intended: deletedTimer, patch: { 'timer-state': { state: 'logged' } }, draft: {}, argv: ['timer', 'log'], commandClass: 'log' }, 'timer-log', deletedTimer],
    ['discard', [baseTimer], { type: 'discard', scope: 'active-timer:timer-1', base: baseTimer, baseToken: tokenA, intended: deletedTimer, patch: { 'timer-state': { state: 'deleted' } }, draft: {}, argv: ['timer', 'discard'], commandClass: 'multi-segment' }, 'timer-discard', deletedTimer],
    ['switch', [baseTimer], { type: 'switch', scope: null, base: baseTimer, baseToken: tokenA, intended: timer('target', { token: tokenB }), patch: { assignment: { projectId: '77' } }, draft: {}, argv: ['timer', 'switch'], commandClass: 'switch' }, 'timer-switch', timer('target', { token: tokenB })]
  ]
  for (const [name, records, intent, mutationKind, resultRecord] of cases) {
    await t.test(`${name} receipt`, () => {
      const service = runtime(records)
      const request = persistThenStart(service, intent)
      const scope = request.scope
      settle(service, request, receipt(mutationKind, intent.base, resultRecord, scope))
      assert.equal(service.getView().operations.at(-1).state, 'settled')
    })
    await t.test(`${name} unknown`, () => {
      const service = runtime(records)
      const request = persistThenStart(service, intent)
      service.adapterCompleted({ ...request, outcome: 'unknown', error: { code: 'TIMEOUT' } })
      assert.equal(service.getView().operations.at(-1).state, 'unknown')
    })
    await t.test(`${name} known error`, () => {
      const service = runtime(records)
      const request = persistThenStart(service, intent)
      service.adapterCompleted({
        ...request,
        outcome: 'known-error',
        error: { code: 'VALIDATION_FAILED', message: 'Rejected without applying' }
      })
      const [save] = service.takeActions()
      assert.equal(save.type, 'persist')
      const durableKnownError = Store.deserialize(Store.serialize(save.snapshot)).snapshot
      assert.equal(durableKnownError.operations.at(-1).knownError.code, 'VALIDATION_FAILED')
      assert.equal(service.getView().operations.at(-1).state, 'in-flight')
      service.storeSaved(save.transactionId)
      assert.equal(service.getView().operations.at(-1).state, 'not-applied')
      assert.equal(service.getView().operations.at(-1).draftAvailable, true)
      assert.equal(service.getView().actions[request.scope].canMutate, true)
      assert.equal(service.getView().errors.at(-1).code, 'VALIDATION_FAILED')
      const restarted = createServiceRuntime({ Ledger, Coordinator, budgets })
      restarted.startup(durableKnownError)
      assert.equal(restarted.getView().operations.at(-1).state, 'not-applied')
      assert.equal(restarted.getView().operations.at(-1).draftAvailable, true)
      assert.equal(restarted.getView().errors.at(-1).code, 'VALIDATION_FAILED')
    })
    if (intent.base) await t.test(`${name} conflict`, () => {
      const service = runtime(records)
      const request = persistThenStart(service, intent)
      const current = {
        contractVersion: 2, kind: intent.base.kind, id: intent.base.id, exists: false, token: null
      }
      service.adapterCompleted({ ...request, outcome: 'known-error', error: { code: 'GUARD_REJECTED', details: {
        contractVersion: 2, identity: { kind: current.kind, id: current.id }, expectedToken: intent.baseToken,
        currentToken: null, current
      } } })
      assert.equal(service.getView().operations.at(-1).state, 'conflicted')
    })
  }
})
