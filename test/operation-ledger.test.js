const test = require('node:test')
const assert = require('node:assert/strict')

const Ledger = require('../OperationLedger.js')
const Store = require('../LedgerStoreModel.js')

const token = 'a'.repeat(64)

function entry(id = '9', overrides = {}) {
  return {
    contractVersion: 2,
    kind: 'time-entry',
    id,
    exists: true,
    localDate: '2026-09-02',
    startedAt: '2026-09-02T17:00:00.000Z',
    durationSeconds: 3600,
    projectId: '44',
    clientId: '55',
    serviceId: '66',
    note: 'Planning',
    billable: true,
    billed: false,
    token,
    ...overrides
  }
}

function initial(records = [entry(), entry('10')]) {
  let sequence = 0
  return Ledger.initialState({
    records,
    nextOperationSequence: () => ++sequence
  })
}

function saveEvent(overrides = {}) {
  const base = entry()
  return {
    type: 'intent',
    intent: {
      type: 'save-entry',
      scope: 'time-entry:9',
      baseContractVersion: 2,
      baseToken: base.token,
      base,
      patch: { note: 'Changed locally' },
      draft: { note: 'Changed locally', duration: '1:00' },
      argv: ['time', 'update', '9', '--note', 'Changed locally'],
      commandClass: 'single-write',
      ...overrides
    }
  }
}

function prepare(state = initial(), overrides = {}) {
  return Ledger.apply(state, saveEvent(overrides))
}

function persisted(state, transactionId = 'operation-1') {
  return Ledger.apply(state, { type: 'persisted', transactionId })
}

function started(state) {
  return Ledger.apply(state, { type: 'request-started', operationId: 'operation-1', requestId: 'request-1' })
}

function matchingReceipt() {
  const result = entry('9', { note: 'Changed locally', token: 'b'.repeat(64) })
  return {
    contractVersion: 2,
    mutationKind: 'time-entry-update',
    changes: [{
      scope: 'time-entry:9',
      before: { token },
      after: { record: result }
    }],
    results: [result],
    phase: null
  }
}

function deleted(kind = 'time-entry', id = '9') {
  return { contractVersion: 2, kind, id, exists: false, token: null }
}

function activeTimer(overrides = {}) {
  return {
    contractVersion: 2,
    kind: 'active-timer',
    id: 'timer-1',
    exists: true,
    segments: [{
      contractVersion: 2,
      kind: 'timer-segment',
      id: 'segment-1',
      timerId: 'timer-1',
      exists: true,
      startedAt: '2026-09-02T17:00:00.000Z',
      durationSeconds: null,
      running: true,
      logged: false,
      token: '1'.repeat(64)
    }],
    state: 'running',
    elapsedAnchor: {
      closedSeconds: 0,
      runningStartedAt: '2026-09-02T17:00:00.000Z',
      observedAt: '2026-09-02T17:30:00.000Z'
    },
    projectId: '44',
    clientId: '55',
    serviceId: '66',
    note: 'Planning',
    billable: true,
    token,
    ...overrides
  }
}

function inFlight(state = initial(), overrides = {}) {
  let result = prepare(state, overrides)
  result = persisted(result.state, result.state.operations.at(-1).operationId)
  return Ledger.apply(result.state, {
    type: 'request-started',
    operationId: result.state.operations.at(-1).operationId,
    requestId: result.state.operations.at(-1).request.requestId
  })
}

function guardRejected(state, operationId, current) {
  return Ledger.apply(state, {
    type: 'completion',
    operationId,
    outcome: 'known-error',
    error: {
      code: 'GUARD_REJECTED',
      message: 'FreshBooks changed',
      details: {
        contractVersion: 2,
        identity: { kind: current.kind, id: current.id },
        expectedToken: state.operations.find(operation => operation.operationId === operationId).baseToken,
        currentToken: current.token,
        current
      }
    }
  })
}

test('save prepares durable draft and optimistic immutable view before request', () => {
  const result = prepare()

  assert.equal(result.state.operations[0].operationId, 'operation-1')
  assert.equal(result.state.operations[0].state, 'prepared')
  assert.deepEqual(result.state.operations[0].draft, { note: 'Changed locally', duration: '1:00' })
  assert.equal(result.view.records['time-entry:9'].note, 'Changed locally')
  assert.equal(result.view.operations[0].draftAvailable, true)
  assert.deepEqual(result.effects.map(effect => effect.type), ['persist'])
  assert.equal(result.effects[0].transactionId, 'operation-1')
  assert.equal(Object.isFrozen(result.view), true)
  assert.equal(Object.isFrozen(result.view.records), true)
  assert.equal(Object.isFrozen(result.view.records['time-entry:9']), true)
  assert.equal(Reflect.set(result.view.records['time-entry:9'], 'note', 'mutated'), false)
  assert.equal(result.state.records['time-entry:9'].note, 'Changed locally')
})

test('persisted then request-started transitions prepared to in-flight', () => {
  const prepared = prepare()
  const afterSave = persisted(prepared.state)

  assert.equal(afterSave.state.operations[0].state, 'prepared')
  assert.deepEqual(afterSave.effects.map(effect => effect.type), ['request'])
  assert.equal(afterSave.effects[0].operationId, 'operation-1')
  assert.equal(afterSave.effects[0].scope, 'time-entry:9')

  const inFlight = started(afterSave.state)
  assert.equal(inFlight.state.operations[0].state, 'in-flight')
  assert.deepEqual(inFlight.effects.map(effect => effect.type), ['persist'])
  assert.equal(inFlight.effects[0].transactionId, 'started-operation-1')
  assert.equal(inFlight.effects[0].snapshot.operations[0].state, 'in-flight')

  const startSaved = persisted(inFlight.state, 'started-operation-1')
  assert.deepEqual(startSaved.effects, [])
})

test('matching receipt settles clears draft and releases only its scope', () => {
  let result = prepare()
  result = persisted(result.state)
  result = started(result.state)
  result = Ledger.apply(result.state, {
    type: 'completion',
    operationId: 'operation-1',
    outcome: 'receipt',
    data: matchingReceipt()
  })
  assert.equal(result.state.operations[0].state, 'in-flight')
  assert.deepEqual(result.state.operations[0].draft, { note: 'Changed locally', duration: '1:00' })
  assert.equal(result.view.actions['time-entry:9'].canMutate, false)
  assert.deepEqual(result.effects.map(effect => effect.type), ['persist'])
  assert.equal(result.effects[0].transactionId, 'settlement-operation-1')
  assert.equal(result.effects[0].snapshot.operations[0].state, 'settled')

  result = persisted(result.state, 'settlement-operation-1')
  assert.equal(result.state.operations[0].state, 'settled')
  assert.equal(result.state.operations[0].draft, null)
  assert.equal(result.view.records['time-entry:9'].token, 'b'.repeat(64))
  assert.equal(result.view.actions['time-entry:9'].canMutate, true)
  assert.equal(result.view.actions['time-entry:10'].canMutate, true)
  assert.deepEqual(result.effects.map(effect => effect.type), ['compact'])
})

test('successful receipt emits zero mandatory follow-up reads', () => {
  let result = prepare()
  result = persisted(result.state)
  result = started(result.state)
  result = Ledger.apply(result.state, {
    type: 'completion',
    operationId: 'operation-1',
    outcome: 'receipt',
    data: matchingReceipt()
  })

  assert.equal(result.effects.some(effect => effect.type === 'request'), false)
})

test('unrelated record remains mutable while one scope is locked', () => {
  let result = prepare()
  result = persisted(result.state)
  result = started(result.state)

  assert.equal(result.view.actions['time-entry:9'].canMutate, false)
  assert.equal(result.view.actions['time-entry:9'].canNavigate, true)
  assert.equal(result.view.actions['time-entry:10'].canMutate, true)
  assert.equal(result.view.actions['time-entry:10'].canNavigate, true)

  const unrelated = Ledger.apply(result.state, saveEvent({
    scope: 'time-entry:10',
    base: entry('10'),
    baseToken: token,
    patch: { note: 'Independent edit' },
    draft: { note: 'Independent edit' },
    argv: ['time', 'update', '10']
  }))
  assert.equal(unrelated.state.operations.length, 2)
  assert.equal(unrelated.state.operations[1].scope, 'time-entry:10')
  assert.deepEqual(unrelated.effects.map(effect => effect.type), ['persist'])
})

test('settlement persistence failure retains recoverable draft projection and lock', () => {
  let result = prepare()
  result = persisted(result.state)
  result = started(result.state)
  result = Ledger.apply(result.state, {
    type: 'completion',
    operationId: 'operation-1',
    outcome: 'receipt',
    data: matchingReceipt()
  })
  result = Ledger.apply(result.state, {
    type: 'persistence-failed',
    transactionId: 'settlement-operation-1',
    error: 'disk full'
  })

  assert.equal(result.state.operations[0].state, 'in-flight')
  assert.deepEqual(result.state.operations[0].draft, { note: 'Changed locally', duration: '1:00' })
  assert.equal(result.state.records['time-entry:9'].note, 'Changed locally')
  assert.equal(result.state.records['time-entry:9'].token, token)
  assert.equal(result.view.actions['time-entry:9'].canMutate, false)
  assert.equal(result.view.errors[0].code, 'LEDGER_WRITE_FAILED')
  assert.deepEqual(result.effects, [])
})

test('persistence failure never dispatches prepared mutation', () => {
  const prepared = prepare()
  const failed = Ledger.apply(prepared.state, {
    type: 'persistence-failed',
    transactionId: 'operation-1',
    error: 'disk full'
  })

  assert.equal(failed.state.operations[0].state, 'prepared')
  assert.deepEqual(failed.state.operations[0].draft, { note: 'Changed locally', duration: '1:00' })
  assert.equal(failed.view.records['time-entry:9'].note, 'Changed locally')
  assert.equal(failed.view.errors[0].code, 'LEDGER_WRITE_FAILED')
  assert.equal(failed.view.errors[0].persistent, true)
  assert.deepEqual(failed.effects, [])
})

test('creation uses operation identity in provisional scope', () => {
  const state = initial([])
  const result = Ledger.apply(state, saveEvent({
    scope: null,
    base: null,
    baseToken: null,
    patch: { note: 'New entry' },
    intended: entry('provisional', { note: 'New entry' }),
    draft: { note: 'New entry' },
    argv: ['time', 'create']
  }))

  assert.equal(result.state.operations[0].scope, 'provisional:operation-1:time-entry-create')
  assert.equal(result.effects[0].snapshot.operations[0].scope, 'provisional:operation-1:time-entry-create')
})

test('prepared in-flight and settled ledger snapshots round-trip through durable store', () => {
  let result = prepare()
  let restored = Store.deserialize(Store.serialize(result.effects[0].snapshot))
  assert.equal(restored.recoveryError, null)
  assert.equal(restored.snapshot.operations[0].state, 'prepared')

  result = persisted(result.state)
  result = started(result.state)
  restored = Store.deserialize(Store.serialize(result.effects[0].snapshot))
  assert.equal(restored.recoveryError, null)
  assert.equal(restored.snapshot.operations[0].state, 'in-flight')

  result = Ledger.apply(result.state, {
    type: 'completion',
    operationId: 'operation-1',
    outcome: 'receipt',
    data: matchingReceipt()
  })
  restored = Store.deserialize(Store.serialize(result.effects[0].snapshot))
  assert.equal(restored.recoveryError, null)
  assert.equal(restored.snapshot.operations[0].state, 'settled')
})

test('non-overlapping remote edit auto-merges and emits one newly guarded mutation', () => {
  let result = inFlight(initial(), {
    patch: { assignment: { projectId: '99', serviceId: '88' } },
    draft: { projectId: '99', serviceId: '88' },
    argv: ['time', 'update', '9', '--guard', token, '--project', '99', '--service', '88']
  })
  const current = entry('9', {
    note: 'Changed remotely',
    clientId: '77',
    billable: false,
    token: 'b'.repeat(64)
  })

  result = guardRejected(result.state, 'operation-1', current)

  assert.deepEqual(Ledger.changedGroups(entry(), result.state.operations[0].intended), ['assignment'])
  assert.equal(result.state.operations[0].state, 'superseded')
  assert.equal(result.state.operations[1].state, 'prepared')
  assert.equal(result.state.operations[1].lineage, 'operation-1')
  assert.equal(result.state.operations[1].baseToken, current.token)
  assert.equal(result.state.operations[1].intended.note, 'Changed remotely')
  assert.equal(result.state.operations[1].intended.projectId, '99')
  assert.equal(result.state.operations[1].intended.serviceId, '88')
  assert.equal(result.state.operations[1].intended.clientId, '77')
  assert.equal(result.state.operations[1].intended.billable, false)
  assert.deepEqual(result.effects.map(effect => effect.type), ['persist'])
  assert.equal(Store.deserialize(Store.serialize(result.effects[0].snapshot)).recoveryError, null)

  result = persisted(result.state, 'operation-2')
  assert.deepEqual(result.effects.map(effect => effect.type), ['request'])
  assert.equal(result.effects[0].operationId, 'operation-2')
  assert.equal(result.effects[0].argv.filter(value => value === '--guard').length, 1)
  assert.equal(result.effects[0].argv[result.effects[0].argv.indexOf('--guard') + 1], current.token)
})

test('note value --guard survives guarded rebase', () => {
  let result = inFlight(initial(), {
    patch: { note: '--guard' },
    draft: { note: '--guard' },
    argv: ['time', 'update', '9', '--note', '--guard', '--guard', token]
  })
  result = guardRejected(result.state, 'operation-1', entry('9', {
    durationSeconds: 7200,
    token: 'b'.repeat(64)
  }))
  result = persisted(result.state, 'operation-2')

  assert.deepEqual(result.effects[0].argv, [
    'time', 'update', '9', '--note', '--guard', '--guard', 'b'.repeat(64)
  ])
})

test('same-field same-value settles without a choice', () => {
  let result = inFlight()
  result = guardRejected(result.state, 'operation-1', entry('9', {
    note: 'Changed locally',
    token: 'b'.repeat(64)
  }))
  assert.equal(result.state.operations[0].state, 'in-flight')
  assert.equal(result.effects[0].transactionId, 'resolution-operation-1')
  assert.equal(Store.deserialize(Store.serialize(result.effects[0].snapshot)).recoveryError, null)
  result = persisted(result.state, 'resolution-operation-1')

  assert.equal(result.state.operations[0].state, 'settled')
  assert.equal(result.state.operations.length, 1)
  assert.equal(result.view.conflicts.length, 0)
  assert.equal(result.view.records['time-entry:9'].note, 'Changed locally')
  assert.equal(result.view.records['time-entry:9'].token, 'b'.repeat(64))
  assert.equal(result.effects.some(effect => effect.type === 'request'), false)
  const later = Ledger.apply(result.state, saveEvent({
    scope: 'time-entry:10',
    base: entry('10'),
    patch: { note: 'Later edit' },
    draft: { note: 'Later edit' },
    argv: ['time', 'update', '10']
  }))
  assert.equal(Store.deserialize(Store.serialize(later.effects[0].snapshot)).recoveryError, null)
})

test('token mismatch with equal canonical semantics settles silently', () => {
  let result = inFlight(initial(), {
    patch: { note: 'Planning' },
    draft: { note: 'Planning' }
  })
  result = guardRejected(result.state, 'operation-1', entry('9', { token: 'b'.repeat(64) }))
  assert.equal(result.state.operations[0].state, 'in-flight')
  result = persisted(result.state, 'resolution-operation-1')

  assert.equal(result.state.operations[0].state, 'settled')
  assert.deepEqual(result.view.conflicts, [])
  assert.equal(result.view.records['time-entry:9'].token, 'b'.repeat(64))
  assert.equal(result.effects.some(effect => effect.type === 'request'), false)
})

test('divergent same-field edits expose only that group', () => {
  let result = inFlight()
  const current = entry('9', {
    note: 'Changed remotely',
    durationSeconds: 7200,
    token: 'b'.repeat(64)
  })
  result = guardRejected(result.state, 'operation-1', current)

  assert.equal(result.state.operations[0].state, 'conflicted')
  assert.deepEqual(result.view.conflicts[0].groups.map(choice => choice.group), ['note'])
  assert.equal(result.view.conflicts[0].groups[0].mine, 'Changed locally')
  assert.equal(result.view.conflicts[0].groups[0].freshbooks, 'Changed remotely')
  assert.equal(result.view.records['time-entry:9'].durationSeconds, 7200)
  assert.equal(result.view.conflicts[0].deletion, false)
  assert.equal(Store.deserialize(Store.serialize(result.effects[0].snapshot)).recoveryError, null)
})

test('mine resolution guards latest current record', () => {
  let result = inFlight()
  const current = entry('9', { note: 'Changed remotely', token: 'b'.repeat(64) })
  result = guardRejected(result.state, 'operation-1', current)
  result = Ledger.apply(result.state, {
    type: 'intent',
    intent: { type: 'choose-mine', operationId: 'operation-1', group: 'note' }
  })

  assert.equal(result.state.operations[0].state, 'superseded')
  assert.equal(result.state.operations[1].lineage, 'operation-1')
  assert.equal(result.state.operations[1].baseToken, current.token)
  assert.equal(result.state.operations[1].intended.note, 'Changed locally')
  assert.deepEqual(result.effects.map(effect => effect.type), ['persist'])

  result = persisted(result.state, 'operation-2')
  const guardIndex = result.effects[0].argv.indexOf('--guard')
  assert.equal(result.effects[0].argv[guardIndex + 1], current.token)
})

test('freshbooks resolution adopts only selected group', () => {
  let result = inFlight(initial(), {
    patch: { note: 'Mine note', duration: 4000 },
    draft: { note: 'Mine note', durationSeconds: 4000 }
  })
  result = guardRejected(result.state, 'operation-1', entry('9', {
    note: 'Remote note',
    durationSeconds: 5000,
    token: 'b'.repeat(64)
  }))
  result = Ledger.apply(result.state, {
    type: 'intent',
    intent: { type: 'choose-freshbooks', operationId: 'operation-1', group: 'note' }
  })

  assert.equal(result.state.operations[0].state, 'conflicted')
  assert.deepEqual(result.view.conflicts[0].groups.map(choice => choice.group), ['duration'])
  assert.equal(result.view.records['time-entry:9'].note, 'Remote note')
  assert.equal(result.view.records['time-entry:9'].durationSeconds, 4000)
  assert.deepEqual(result.effects.map(effect => effect.type), ['persist'])
  assert.equal(result.effects.some(effect => effect.type === 'request'), false)

  result = Ledger.apply(result.state, {
    type: 'intent',
    intent: { type: 'choose-mine', operationId: 'operation-1', group: 'duration' }
  })
  assert.equal(result.state.operations[1].intended.note, 'Remote note')
  assert.equal(result.state.operations[1].intended.durationSeconds, 4000)
  assert.equal(result.state.operations[1].baseToken, 'b'.repeat(64))

  let reversed = inFlight(initial(), {
    patch: { note: 'Mine note', duration: 4000 },
    draft: { note: 'Mine note', durationSeconds: 4000 }
  })
  reversed = guardRejected(reversed.state, 'operation-1', entry('9', {
    note: 'Remote note',
    durationSeconds: 5000,
    token: 'b'.repeat(64)
  }))
  reversed = Ledger.apply(reversed.state, {
    type: 'intent',
    intent: { type: 'choose-mine', operationId: 'operation-1', group: 'note' }
  })
  reversed = Ledger.apply(reversed.state, {
    type: 'intent',
    intent: { type: 'choose-freshbooks', operationId: 'operation-1', group: 'duration' }
  })
  assert.equal(reversed.state.operations[1].intended.note, 'Mine note')
  assert.equal(reversed.state.operations[1].intended.durationSeconds, 5000)
  reversed = persisted(reversed.state, 'operation-2')
  assert.deepEqual(reversed.effects[0].argv, [
    'time', 'update', '9', '--note', 'Mine note', '--guard', 'b'.repeat(64)
  ])
})

test('second remote change re-runs merge instead of applying stale choice', () => {
  let result = inFlight()
  result = guardRejected(result.state, 'operation-1', entry('9', {
    note: 'First remote note',
    token: 'b'.repeat(64)
  }))
  result = Ledger.apply(result.state, {
    type: 'intent',
    intent: { type: 'choose-mine', operationId: 'operation-1', group: 'note' }
  })
  result = persisted(result.state, 'operation-2')
  result = Ledger.apply(result.state, {
    type: 'request-started',
    operationId: 'operation-2',
    requestId: 'request-2'
  })
  result = guardRejected(result.state, 'operation-2', entry('9', {
    note: 'Second remote note',
    token: 'c'.repeat(64)
  }))

  assert.equal(result.state.operations[1].state, 'conflicted')
  assert.equal(result.state.operations.length, 2)
  assert.equal(result.view.conflicts[0].groups[0].mine, 'Changed locally')
  assert.equal(result.view.conflicts[0].groups[0].freshbooks, 'Second remote note')
  assert.equal(result.effects.some(effect => effect.type === 'request'), false)
})

test('remote deletion with unchanged local accepts deletion', () => {
  let result = inFlight(initial(), {
    patch: { note: 'Planning' },
    draft: { note: 'Planning' }
  })
  result = guardRejected(result.state, 'operation-1', deleted())
  assert.equal(result.state.operations[0].state, 'in-flight')
  assert.notEqual(result.view.records['time-entry:9'], undefined)
  result = persisted(result.state, 'resolution-operation-1')

  assert.equal(result.state.operations[0].state, 'settled')
  assert.equal(result.view.records['time-entry:9'], undefined)
  assert.deepEqual(result.view.conflicts, [])
})

test('remote deletion with local edit offers restore or discard', () => {
  let result = inFlight()
  result = guardRejected(result.state, 'operation-1', deleted())

  assert.equal(result.state.operations[0].state, 'conflicted')
  assert.equal(result.view.conflicts[0].deletion, true)
  assert.deepEqual(result.view.conflicts[0].groups, [])
  assert.equal(result.view.actions['time-entry:9'].canResolve, true)
  assert.equal(result.effects.some(effect => effect.type === 'request'), false)

  result = Ledger.apply(result.state, {
    type: 'intent',
    intent: { type: 'discard-local', scope: 'time-entry:9' }
  })
  assert.equal(result.state.operations[0].state, 'conflicted')
  assert.equal(result.effects[0].transactionId, 'resolution-operation-1')
  result = persisted(result.state, 'resolution-operation-1')
  assert.equal(result.state.operations[0].state, 'settled')
  assert.equal(result.view.records['time-entry:9'], undefined)
  assert.equal(result.view.actions['time-entry:9'].canMutate, true)
})

test('restore as new omits deleted identity and uses provisional scope', () => {
  let result = inFlight(initial([entry('9', { projectId: null, serviceId: null })]), {
    base: entry('9', { projectId: null, serviceId: null }),
    patch: { note: 'Changed locally' }
  })
  result = guardRejected(result.state, 'operation-1', deleted())
  result = Ledger.apply(result.state, {
    type: 'intent',
    intent: { type: 'restore-as-new', operationId: 'operation-1' }
  })

  const replacement = result.state.operations[1]
  assert.equal(result.state.operations[0].state, 'superseded')
  assert.equal(replacement.kind, 'save-entry')
  assert.equal(replacement.scope, 'provisional:operation-2:time-entry-create')
  assert.equal(replacement.base, null)
  assert.equal(replacement.baseToken, null)
  assert.equal(replacement.intended.id, 'provisional')
  assert.equal(replacement.intended.note, 'Changed locally')
  assert.equal(replacement.intended.localDate, '2026-09-02')
  assert.equal(replacement.intended.startedAt, '2026-09-02T17:00:00.000Z')
  assert.notEqual(replacement.intended.token, token)
  assert.equal(replacement.intended.clientId, null)
  assert.equal(replacement.intended.billable, false)
  assert.equal(replacement.request.argv.includes('9'), false)
  assert.equal(replacement.request.argv.includes('--guard'), false)
  assert.equal(replacement.request.argv.includes('--project'), false)
  assert.equal(replacement.request.argv.includes('--service'), false)
  assert.equal(replacement.request.argv.includes(''), false)
  assert.equal(Store.deserialize(Store.serialize(result.effects[0].snapshot)).recoveryError, null)

  const base = activeTimer()
  let timerResult = inFlight(initial([base]), {
    type: 'update-note',
    scope: 'active-timer:timer-1',
    base,
    baseToken: token,
    patch: { note: 'Changed locally' },
    draft: { note: 'Changed locally' },
    argv: ['timer', 'update', '--id', 'timer-1', '--guard', token, '--note', 'Changed locally']
  })
  timerResult = guardRejected(timerResult.state, 'operation-1', deleted('active-timer', 'timer-1'))
  timerResult = Ledger.apply(timerResult.state, {
    type: 'intent',
    intent: { type: 'restore-as-new', scope: 'active-timer:timer-1' }
  })
  const restoredTimer = timerResult.state.operations[1]
  assert.equal(restoredTimer.kind, 'start')
  assert.equal(restoredTimer.scope, 'provisional:operation-2:active-timer-create')
  assert.equal(restoredTimer.intended.id, 'provisional')
  assert.equal(restoredTimer.intended.segments[0].timerId, 'provisional')
  assert.notEqual(restoredTimer.intended.token, base.token)
  assert.notEqual(restoredTimer.intended.segments[0].id, base.segments[0].id)
  assert.notEqual(restoredTimer.intended.segments[0].token, base.segments[0].token)
  assert.equal(restoredTimer.request.argv.includes('timer-1'), false)
  assert.equal(restoredTimer.request.argv.includes(''), false)
  assert.equal(Store.deserialize(Store.serialize(timerResult.effects[0].snapshot)).recoveryError, null)
})

test('local delete against changed current conflicts on timer-state', () => {
  let result = inFlight(initial(), {
    type: 'discard',
    patch: { 'timer-state': { state: 'deleted' } },
    intended: deleted(),
    draft: { state: 'deleted' },
    argv: ['time', 'delete', '9', '--guard', token, '--yes']
  })
  result = guardRejected(result.state, 'operation-1', entry('9', {
    note: 'Changed remotely',
    token: 'b'.repeat(64)
  }))

  assert.equal(result.state.operations[0].state, 'conflicted')
  assert.deepEqual(result.view.conflicts[0].groups.map(choice => choice.group), ['timer-state'])
  assert.deepEqual(result.view.conflicts[0].groups[0].mine, { exists: false })
  assert.deepEqual(result.view.conflicts[0].groups[0].freshbooks, { exists: true })
  result = Ledger.apply(result.state, {
    type: 'intent',
    intent: { type: 'choose-freshbooks', operationId: 'operation-1', group: 'timer-state' }
  })
  assert.equal(result.state.operations.length, 1)
  assert.equal(result.state.operations[0].state, 'conflicted')
  assert.equal(result.effects[0].transactionId, 'resolution-operation-1')
  result = persisted(result.state, 'resolution-operation-1')
  assert.equal(result.state.operations[0].state, 'settled')
  assert.equal(result.view.records['time-entry:9'].note, 'Changed remotely')
  assert.equal(result.effects.some(effect => effect.type === 'request'), false)
})

test('active timer duration belongs to only the duration group', () => {
  const base = activeTimer()
  const corrected = activeTimer({
    elapsedAnchor: {
      ...base.elapsedAnchor,
      closedSeconds: 60
    }
  })

  assert.deepEqual(Ledger.changedGroups(base, corrected), ['duration'])
})

test('already achieved timer state settles while invalid structural transition conflicts', () => {
  const base = activeTimer()
  const paused = activeTimer({
    segments: [activeTimer().segments[0], {
      ...activeTimer().segments[0],
      id: 'segment-2',
      durationSeconds: 1800,
      running: false,
      token: '2'.repeat(64)
    }],
    state: 'paused',
    elapsedAnchor: {
      closedSeconds: 1800,
      runningStartedAt: null,
      observedAt: '2026-09-02T17:30:00.000Z'
    },
    token: 'b'.repeat(64)
  })
  let achieved = inFlight(initial([base]), {
    type: 'pause',
    scope: 'active-timer:timer-1',
    base,
    baseToken: token,
    patch: { 'timer-state': { state: 'paused' } },
    intended: paused,
    draft: { state: 'paused' },
    argv: ['timer', 'pause', '--id', 'timer-1', '--guard', token]
  })
  achieved = guardRejected(achieved.state, 'operation-1', paused)
  assert.equal(achieved.state.operations[0].state, 'in-flight')
  achieved = persisted(achieved.state, 'resolution-operation-1')
  assert.equal(achieved.state.operations[0].state, 'settled')

  const structurallyChanged = activeTimer({
    segments: [{
      ...activeTimer().segments[0],
      id: 'replacement-segment',
      startedAt: '2026-09-02T17:15:00.000Z',
      token: '3'.repeat(64)
    }],
    elapsedAnchor: {
      closedSeconds: 0,
      runningStartedAt: '2026-09-02T17:15:00.000Z',
      observedAt: '2026-09-02T17:30:00.000Z'
    },
    token: 'c'.repeat(64)
  })
  let invalid = inFlight(initial([base]), {
    type: 'resume',
    scope: 'active-timer:timer-1',
    base,
    baseToken: token,
    patch: { 'timer-state': { state: 'paused' } },
    intended: paused,
    draft: { state: 'paused' },
    argv: ['timer', 'pause', '--id', 'timer-1', '--guard', token]
  })
  invalid = guardRejected(invalid.state, 'operation-1', structurallyChanged)
  assert.equal(invalid.state.operations[0].state, 'conflicted')
  assert.deepEqual(invalid.view.conflicts[0].groups.map(choice => choice.group), ['timer-state'])
})

function reconcile(state, operationId, records, overrides = {}) {
  let result = Ledger.apply(state, {
    type: 'observation',
    operationId,
    records,
    complete: true,
    includesDeleted: true,
    causalTag: state.operations.find(operation => operation.operationId === operationId).causalTag,
    ...overrides
  })
  const persistence = result.effects.find(effect => effect.type === 'persist')
  if (persistence) result = persisted(result.state, persistence.transactionId)
  return result
}

function unknown(state, operationId = 'operation-1') {
  let result = Ledger.apply(state, {
    type: 'completion',
    operationId,
    outcome: 'unknown',
    error: { code: 'PROCESS_TIMEOUT', message: 'Outcome is unknown' }
  })
  assert.equal(result.state.operations.find(operation => operation.operationId === operationId).state, 'unknown')
  assert.deepEqual(result.effects.map(effect => effect.type), ['persist'])
  result = persisted(result.state, `unknown-${operationId}`)
  return result
}

test('unknown emits reconciliation only and never mutation retry', () => {
  const result = unknown(inFlight().state)
  assert.equal(result.effects.length, 1)
  assert.equal(result.effects[0].requestKind, 'reconciliation')
  assert.equal(result.effects[0].priority, 2)
  assert.equal(result.effects.some(effect => effect.requestKind === 'mutation'), false)
  assert.equal(result.effects[0].scope, 'time-entry:9')
})

test('update reconciliation classifies applied base and changed', () => {
  let applied = unknown(inFlight().state)
  applied = reconcile(applied.state, 'operation-1', [entry('9', {
    note: 'Changed locally',
    token: 'b'.repeat(64)
  })])
  assert.equal(applied.state.operations[0].state, 'settled')
  assert.equal(applied.state.operations[0].draft, null)

  let base = unknown(inFlight().state)
  base = reconcile(base.state, 'operation-1', [entry()])
  assert.equal(base.state.operations[0].state, 'not-applied')
  assert.notEqual(base.state.operations[0].draft, null)
  assert.equal(base.effects.some(effect => effect.requestKind === 'mutation'), false)

  let changed = unknown(inFlight().state)
  changed = reconcile(changed.state, 'operation-1', [entry('9', {
    note: 'Changed remotely',
    token: 'c'.repeat(64)
  })])
  assert.equal(changed.state.operations[0].state, 'conflicted')
})

test('delete reconciliation classifies absent base and changed', () => {
  const deletion = {
    type: 'discard',
    patch: { 'timer-state': { state: 'deleted' } },
    intended: deleted(),
    draft: { note: 'Planning' },
    argv: ['time', 'delete', '9', '--yes', '--guard', token]
  }
  let applied = unknown(inFlight(initial(), deletion).state)
  applied = reconcile(applied.state, 'operation-1', [deleted()])
  assert.equal(applied.state.operations[0].state, 'settled')

  let base = unknown(inFlight(initial(), deletion).state)
  base = reconcile(base.state, 'operation-1', [entry()])
  assert.equal(base.state.operations[0].state, 'not-applied')

  let changed = unknown(inFlight(initial(), deletion).state)
  changed = reconcile(changed.state, 'operation-1', [entry('9', {
    note: 'Changed remotely',
    token: 'b'.repeat(64)
  })])
  assert.equal(changed.state.operations[0].state, 'conflicted')
  assert.deepEqual(changed.view.conflicts[0].groups.map(group => group.group), ['timer-state'])
})

test('create reconciliation classifies unique absent-baseline match no match and duplicate ambiguity', () => {
  const intended = entry('provisional', { token: 'd'.repeat(64) })
  const create = {
    type: 'save-entry',
    scope: null,
    base: null,
    baseToken: null,
    intended,
    patch: { note: intended.note },
    draft: { note: intended.note },
    argv: ['time', 'create', '--note', intended.note]
  }
  const matching = entry('11', { token: 'e'.repeat(64) })
  let unique = unknown(inFlight(initial([entry('10')]), create).state)
  unique = reconcile(unique.state, 'operation-1', [entry('10'), matching])
  assert.equal(unique.state.operations[0].state, 'settled')
  assert.equal(unique.state.records['time-entry:11'].id, '11')

  let absent = unknown(inFlight(initial([entry('10')]), create).state)
  absent = reconcile(absent.state, 'operation-1', [entry('10')])
  assert.equal(absent.state.operations[0].state, 'not-applied')

  let duplicate = unknown(inFlight(initial([entry('10')]), create).state)
  duplicate = reconcile(duplicate.state, 'operation-1', [
    entry('10'),
    matching,
    entry('12', { token: 'f'.repeat(64) })
  ])
  assert.equal(duplicate.state.operations[0].state, 'unknown')
})

test('create reconciliation keeps pre-dispatch identity baseline across observation and restart', () => {
  const baseline = entry('10')
  const intended = entry('provisional', { token: 'd'.repeat(64) })
  const create = {
    type: 'save-entry',
    scope: null,
    base: null,
    baseToken: null,
    intended,
    patch: { note: intended.note },
    draft: { note: intended.note },
    argv: ['time', 'create', '--note', intended.note]
  }
  let result = unknown(inFlight(initial([baseline]), create).state)
  const applied = entry('11', { token: 'e'.repeat(64) })
  result = Ledger.apply(result.state, {
    type: 'observation',
    records: [applied],
    complete: true,
    includesDeleted: true,
    causalTag: 'cause-2'
  })
  const durable = Store.deserialize(Store.serialize({
    schemaVersion: result.state.schemaVersion,
    operations: result.state.operations,
    records: result.state.records
  }))
  assert.equal(durable.recoveryError, null)
  result = Ledger.apply(Ledger.restore(durable.snapshot), { type: 'startup' })
  result = reconcile(result.state, 'operation-1', [baseline, applied])
  assert.equal(result.state.operations[0].state, 'settled')
  assert.equal(result.state.records['time-entry:11'].id, '11')
})

test('timer transition reconciliation uses logical semantics', () => {
  const base = activeTimer()
  const intended = activeTimer({
    segments: [{
      ...activeTimer().segments[0],
      durationSeconds: 1800,
      running: false,
      token: '2'.repeat(64)
    }],
    state: 'paused',
    elapsedAnchor: {
      closedSeconds: 1800,
      runningStartedAt: null,
      observedAt: '2026-09-02T17:30:00.000Z'
    },
    token: 'b'.repeat(64)
  })
  let result = unknown(inFlight(initial([base]), {
    type: 'pause',
    scope: 'active-timer:timer-1',
    base,
    intended,
    patch: { 'timer-state': { state: 'paused' } },
    draft: { state: 'paused' },
    argv: ['timer', 'pause', '--id', 'timer-1', '--guard', token]
  }).state)
  const equivalent = {
    ...intended,
    token: 'c'.repeat(64),
    segments: intended.segments.map(segment => ({ ...segment, token: '3'.repeat(64) })),
    elapsedAnchor: { ...intended.elapsedAnchor, observedAt: '2026-09-02T17:31:00.000Z' }
  }
  result = reconcile(result.state, 'operation-1', [equivalent])
  assert.equal(result.state.operations[0].state, 'settled')
})

test('partial switch reconciles log and start separately', () => {
  const base = activeTimer()
  const target = activeTimer({
    id: 'target',
    segments: activeTimer().segments.map(segment => ({ ...segment, id: 'target-segment', timerId: 'target' })),
    projectId: '77',
    token: 'b'.repeat(64)
  })
  let result = unknown(inFlight(initial([base]), {
    type: 'switch',
    scope: null,
    base,
    intended: target,
    patch: { assignment: { projectId: '77' } },
    draft: { projectId: '77' },
    argv: ['timer', 'switch', '--project', '77'],
    commandClass: 'switch'
  }).state)
  result = reconcile(result.state, 'operation-1', [entry('20', {
    note: base.note,
    projectId: base.projectId,
    token: 'c'.repeat(64)
  })], {
    phase: { log: 'confirmed', start: 'failed' }
  })
  assert.equal(result.state.operations[0].state, 'unknown')
  assert.equal(result.state.operations[0].reconciliation.log, 'settled')
  assert.equal(result.state.operations[0].reconciliation.start, 'unknown')
  assert.equal(result.state.records['time-entry:20'].id, '20')

  const partialSnapshot = Store.deserialize(Store.serialize({
    schemaVersion: result.state.schemaVersion,
    operations: result.state.operations,
    records: result.state.records
  })).snapshot
  result = Ledger.apply(Ledger.restore(partialSnapshot), { type: 'startup' })
  assert.equal(result.state.operations[0].reconciliation.log, 'settled')
  assert.equal(result.state.records['time-entry:20'].id, '20')
})

test('receipt followed by delayed pre-mutation observation never rolls back', () => {
  let result = inFlight()
  result = Ledger.apply(result.state, {
    type: 'completion',
    operationId: 'operation-1',
    outcome: 'receipt',
    data: matchingReceipt()
  })
  result = persisted(result.state, 'settlement-operation-1')
  const settledRecord = result.state.records['time-entry:9']
  result = Ledger.apply(result.state, {
    type: 'observation',
    records: [entry()],
    complete: true,
    includesDeleted: true,
    causalTag: 'cause-0'
  })
  assert.deepEqual(result.state.records['time-entry:9'], settledRecord)
  assert.equal(result.state.operations[0].state, 'settled')

  const later = entry('9', { note: 'Changed again later', token: 'c'.repeat(64) })
  result = Ledger.apply(result.state, {
    type: 'observation',
    records: [later],
    complete: true,
    includesDeleted: true,
    causalTag: 'cause-2'
  })
  assert.deepEqual(result.state.records['time-entry:9'], later)
})

test('startup restores projection draft lock and reconciliation', () => {
  let result = unknown(inFlight().state)
  const snapshot = {
    schemaVersion: result.state.schemaVersion,
    operations: result.state.operations,
    records: result.state.records
  }
  const restored = Ledger.restore(snapshot)
  result = Ledger.apply(restored, { type: 'startup' })
  assert.equal(result.view.records['time-entry:9'].note, 'Changed locally')
  assert.equal(result.view.operations[0].draftAvailable, true)
  assert.equal(result.view.actions['time-entry:9'].canMutate, false)
  assert.deepEqual(result.effects.map(effect => effect.requestKind), ['reconciliation'])

  let interrupted = inFlight()
  const interruptedSnapshot = Store.deserialize(Store.serialize({
    schemaVersion: interrupted.state.schemaVersion,
    operations: interrupted.state.operations,
    records: interrupted.state.records
  })).snapshot
  interrupted = Ledger.apply(Ledger.restore(interruptedSnapshot), { type: 'startup' })
  assert.equal(interrupted.state.operations[0].state, 'unknown')
  assert.deepEqual(interrupted.effects.map(effect => effect.type), ['persist'])
  interrupted = persisted(interrupted.state, 'unknown-operation-1')
  assert.deepEqual(interrupted.effects.map(effect => effect.requestKind), ['reconciliation'])

  const baseline = entry('10')
  const intended = entry('provisional', { token: 'd'.repeat(64) })
  let creationResult = unknown(inFlight(initial([baseline]), {
    type: 'save-entry',
    scope: null,
    base: null,
    baseToken: null,
    intended,
    patch: { note: intended.note },
    draft: { note: intended.note },
    argv: ['time', 'create', '--note', intended.note]
  }).state)
  let creation = creationResult.state
  assert.deepEqual(creation.operations.map(operation => operation.operationId), ['operation-1'])
  const durableCreation = Store.deserialize(Store.serialize({
    schemaVersion: creation.schemaVersion,
    operations: creation.operations,
    records: creation.records
  }))
  assert.equal(durableCreation.recoveryError, null)
  assert.deepEqual(durableCreation.snapshot.operations.map(operation => operation.operationId), ['operation-1'])
  creation = Ledger.apply(Ledger.restore(durableCreation.snapshot), { type: 'startup' })
  creation = reconcile(creation.state, 'operation-1', [
    baseline,
    entry('11', { token: 'e'.repeat(64) })
  ])
  assert.equal(creation.state.operations[0].state, 'settled')
})

test('stale cached or older causal observation cannot settle or roll back', () => {
  let result = unknown(inFlight().state)
  const before = result.state.records['time-entry:9']
  result = reconcile(result.state, 'operation-1', [entry('9', {
    note: 'Changed locally',
    token: 'b'.repeat(64)
  })], { cached: true })
  assert.equal(result.state.operations[0].state, 'unknown')
  assert.deepEqual(result.state.records['time-entry:9'], before)

  result = reconcile(result.state, 'operation-1', [entry()], { causalTag: 'cause-0' })
  assert.equal(result.state.operations[0].state, 'unknown')
  assert.deepEqual(result.state.records['time-entry:9'], before)
})
