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
