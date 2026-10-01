const test = require('node:test')
const assert = require('node:assert/strict')

const Store = require('../LedgerStoreModel.js')

const token = 'a'.repeat(64)

function snapshot() {
  const record = {
    contractVersion: 2,
    kind: 'time-entry',
    id: '9',
    exists: true,
    localDate: '2026-09-02',
    startedAt: '2026-09-02T17:00:00.000Z',
    durationSeconds: 3600,
    projectId: '44',
    clientId: '55',
    serviceId: '66',
    note: 'safe',
    billable: true,
    billed: false,
    token
  }
  return {
    schemaVersion: 1,
    operations: [{
      operationId: 'operation-1',
      kind: 'save-entry',
      contractVersion: 2,
      scope: 'time-entry:9',
      state: 'prepared',
      base: record,
      baseToken: token,
      patch: { note: 'safe' },
      intended: record,
      projection: record,
      draft: {
        note: 'safe',
        refreshToken: 'refresh-secret',
        clientSecret: 'client-secret',
        password: 'password-secret',
        body: 'raw-body',
        stderr: 'raw-stderr'
      },
      causalTag: 'cause-1',
      request: {
        requestId: 'request-1',
        commandClass: 'single-write',
        argv: ['time', 'update', '9'],
        stdin: 'runtime-payload',
        runtimeExtras: { private: true }
      },
      receipt: null,
      lineage: null,
      expectedToken: token,
      accessToken: 'oauth-secret',
      authorization: 'Bearer secret',
      requestHeader: { Authorization: 'Bearer nested-secret' },
      rawResponse: '{"private":true}',
      runtimeExtras: { password: 'nested-password' }
    }],
    records: {
      'time-entry:9': {
        ...record,
        rawResponse: { private: true },
        body: 'record-body'
      }
    },
    errors: [{ code: 'not-durable' }],
    runtimeOnly: true
  }
}

function settledSnapshot() {
  const value = structuredClone(snapshot())
  const operation = value.operations[0]
  const result = { ...operation.intended, token: 'b'.repeat(64) }
  operation.state = 'settled'
  operation.draft = null
  operation.projection = null
  operation.receipt = {
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
  value.records = { 'time-entry:9': result }
  return value
}

test('serialization includes only schema operations records and no transport secrets', () => {
  const serialized = Store.serialize(snapshot())
  const persisted = JSON.parse(serialized)

  assert.deepEqual(Object.keys(persisted).sort(), ['operations', 'records', 'schemaVersion'])
  assert.equal(persisted.operations[0].baseToken, token)
  assert.equal(persisted.operations[0].expectedToken, token)
  assert.equal(persisted.records['time-entry:9'].token, token)
  assert.equal(persisted.operations[0].accessToken, undefined)
  assert.equal(persisted.operations[0].authorization, undefined)
  assert.equal(persisted.operations[0].requestHeader, undefined)
  assert.equal(persisted.operations[0].rawResponse, undefined)
  assert.equal(persisted.operations[0].runtimeExtras, undefined)
  assert.equal(persisted.operations[0].draft.refreshToken, undefined)
  assert.equal(persisted.operations[0].draft.clientSecret, undefined)
  assert.equal(persisted.operations[0].draft.password, undefined)
  assert.equal(persisted.operations[0].draft.body, undefined)
  assert.equal(persisted.operations[0].draft.stderr, undefined)
  assert.equal(persisted.operations[0].request.stdin, undefined)
  assert.equal(persisted.operations[0].request.runtimeExtras, undefined)
  assert.equal(persisted.records['time-entry:9'].rawResponse, undefined)
  assert.equal(persisted.records['time-entry:9'].body, undefined)
  assert.equal(/oauth-secret|Bearer|refresh-secret|client-secret|password-secret|raw-body|raw-stderr|runtime-payload|private|record-body/.test(serialized), false)
})

test('serialization rejects incomplete durable operations before writing', () => {
  const incomplete = snapshot()
  delete incomplete.operations[0].request

  assert.throws(() => Store.serialize(incomplete), /invalid durable ledger snapshot/)
})

test('serialization rejects nested untyped patch and draft values', () => {
  const invalidPatch = snapshot()
  invalidPatch.operations[0].patch.note = {
    password: 'nested-password',
    rawResponse: 'nested-raw'
  }
  const invalidDraft = snapshot()
  invalidDraft.operations[0].draft.note = {
    clientSecret: 'nested-client-secret'
  }

  assert.throws(() => Store.serialize(invalidPatch), /invalid durable ledger snapshot/)
  assert.throws(() => Store.serialize(invalidDraft), /invalid durable ledger snapshot/)
})

test('serialization strips nested receipt transport extras', () => {
  const value = settledSnapshot()
  value.operations[0].receipt.changes[0].before.password = 'receipt-password'
  value.operations[0].receipt.changes[0].after.record.rawResponse = 'receipt-raw'
  value.operations[0].receipt.changes[0].runtimeExtras = { clientSecret: 'receipt-client-secret' }

  const serialized = Store.serialize(value)
  const receipt = JSON.parse(serialized).operations[0].receipt
  assert.equal(receipt.changes[0].before.password, undefined)
  assert.equal(receipt.changes[0].after.record.rawResponse, undefined)
  assert.equal(receipt.changes[0].runtimeExtras, undefined)
  assert.equal(/receipt-password|receipt-raw|receipt-client-secret/.test(serialized), false)
})

test('valid schema 1 restores', () => {
  const serialized = Store.serialize(snapshot())
  const restored = Store.deserialize(serialized)

  assert.equal(restored.recoveryError, null)
  assert.equal(restored.unreadText, '')
  assert.deepEqual(restored.effects, [])
  assert.equal(restored.snapshot.schemaVersion, 1)
  assert.equal(restored.snapshot.operations[0].operationId, 'operation-1')
  assert.equal(restored.snapshot.records['time-entry:9'].token, token)
})

test('corrupt input preserves unread text and has no effects', () => {
  const raw = '{"schemaVersion":1'
  const restored = Store.deserialize(raw)

  assert.equal(restored.snapshot, null)
  assert.equal(restored.recoveryError.code, 'LEDGER_CORRUPT')
  assert.equal(restored.unreadText, raw)
  assert.deepEqual(restored.effects, [])
})

test('malformed schema 1 preserves unread text and has no effects', () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    operations: [{ operationId: 'not-an-operation', state: 'prepared' }],
    records: {}
  })
  const restored = Store.deserialize(raw)

  assert.equal(restored.snapshot, null)
  assert.equal(restored.recoveryError.code, 'LEDGER_CORRUPT')
  assert.equal(restored.unreadText, raw)
  assert.deepEqual(restored.effects, [])
})

test('incomplete duplicate and mismatched schema 1 operations are corrupt', () => {
  const incomplete = snapshot()
  delete incomplete.operations[0].request

  const duplicate = snapshot()
  duplicate.operations.push({
    ...duplicate.operations[0],
    operationId: 'operation-2',
    scope: 'time-entry:9'
  })

  const mismatchedRecord = snapshot()
  mismatchedRecord.records = { 'time-entry:wrong': mismatchedRecord.records['time-entry:9'] }

  for (const value of [incomplete, duplicate, mismatchedRecord]) {
    const raw = JSON.stringify({
      schemaVersion: value.schemaVersion,
      operations: value.operations,
      records: value.records
    })
    const restored = Store.deserialize(raw)
    assert.equal(restored.snapshot, null)
    assert.equal(restored.recoveryError.code, 'LEDGER_CORRUPT')
    assert.equal(restored.unreadText, raw)
    assert.deepEqual(restored.effects, [])
  }
})

test('unsupported input preserves unread text and has no effects', () => {

  const raw = JSON.stringify({ schemaVersion: 2, operations: [], records: {} })
  const restored = Store.deserialize(raw)

  assert.equal(restored.snapshot, null)
  assert.equal(restored.recoveryError.code, 'LEDGER_SCHEMA_UNSUPPORTED')
  assert.equal(restored.unreadText, raw)
  assert.deepEqual(restored.effects, [])
})

test('malformed settled receipts preserve unread text and have no effects', () => {
  const baseline = JSON.parse(Store.serialize(settledSnapshot()))
  const duplicateScope = structuredClone(baseline)
  duplicateScope.operations[0].receipt.changes.push(
    structuredClone(duplicateScope.operations[0].receipt.changes[0])
  )
  duplicateScope.operations[0].receipt.results.push(
    structuredClone(duplicateScope.operations[0].receipt.results[0])
  )

  const invalidBefore = structuredClone(baseline)
  invalidBefore.operations[0].receipt.changes[0].before.password = 'secret'

  const invalidPhase = structuredClone(baseline)
  invalidPhase.operations[0].receipt.phase = { log: 'confirmed', start: 'failed' }

  const mismatchedResult = structuredClone(baseline)
  mismatchedResult.operations[0].receipt.results[0].note = 'different'

  const invalidCanonicalRecord = structuredClone(baseline)
  invalidCanonicalRecord.operations[0].receipt.changes[0].after.record.startedAt = 'not-an-instant'
  invalidCanonicalRecord.operations[0].receipt.results[0].startedAt = 'not-an-instant'

  const uncoveredScope = structuredClone(baseline)
  uncoveredScope.operations[0].scope = 'time-entry:10'

  for (const value of [
    duplicateScope,
    invalidBefore,
    invalidPhase,
    mismatchedResult,
    invalidCanonicalRecord,
    uncoveredScope
  ]) {
    const raw = JSON.stringify(value)
    const restored = Store.deserialize(raw)
    assert.equal(restored.snapshot, null)
    assert.equal(restored.recoveryError.code, 'LEDGER_CORRUPT')
    assert.equal(restored.unreadText, raw)
    assert.deepEqual(restored.effects, [])
  }
})
