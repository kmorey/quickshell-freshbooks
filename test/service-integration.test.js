const test = require('node:test')
const assert = require('node:assert/strict')

const Ledger = require('../OperationLedger.js')
const Coordinator = require('../RequestCoordinator.js')
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

test('partial switch preserves logged result', () => {
  const base = timer()
  const target = timer('target', { projectId: '77', token: tokenB })
  const service = runtime([base])
  const request = persistThenStart(service, {
    type: 'switch', scope: null, base, baseToken: base.token, intended: target,
    patch: { assignment: { projectId: '77' } }, draft: { projectId: '77' },
    argv: ['timer', 'switch', '--project', '77', '--guard', tokenA], commandClass: 'switch'
  })
  const logged = entry('20', { token: 'c'.repeat(64) })
  const oldDeleted = { contractVersion: 2, kind: 'active-timer', id: base.id, exists: false, token: null }
  service.adapterCompleted({ ...request, outcome: 'known-error', error: {
    code: 'TIMER_SWITCH_PARTIAL', details: { partialReceipt: {
      contractVersion: 2, mutationKind: 'timer-switch',
      changes: [{ scope: 'active-timer:timer-1', before: { token: tokenA }, after: { deleted: true } }],
      results: [logged, oldDeleted], phase: { log: 'confirmed', start: 'failed' }
    }, startError: { code: 'START_FAILED', message: 'failed' } }
  } })
  let actions = service.takeActions()
  assert.deepEqual(actions.map(action => action.type), ['persist'])
  service.storeSaved(actions[0].transactionId)
  actions = service.takeActions()
  const partialSave = actions.find(action => action.type === 'persist')
  assert.ok(partialSave)
  service.storeSaved(partialSave.transactionId)
  assert.equal(service.getView().records['time-entry:20'].id, '20')
  assert.equal(service.getView().operations.at(-1).state, 'unknown')
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
    ['pause', [baseTimer], { type: 'pause', scope: 'active-timer:timer-1', base: baseTimer, baseToken: tokenA, intended: timer('timer-1', { state: 'paused', token: tokenB }), patch: { 'timer-state': { state: 'paused' } }, draft: {}, argv: ['timer', 'pause'], commandClass: 'multi-segment' }, 'timer-pause', timer('timer-1', { state: 'paused', token: tokenB })],
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
    await t.test(`${name} conflict`, () => {
      const service = runtime(records)
      const request = persistThenStart(service, intent)
      if (!intent.base) {
        service.adapterCompleted({ ...request, outcome: 'known-error', error: { code: 'VALIDATION_FAILED' } })
        assert.equal(service.getView().operations.at(-1).state, 'in-flight')
        return
      }
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
