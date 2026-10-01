const test = require('node:test')
const assert = require('node:assert/strict')

const Store = require('../LedgerStoreModel.js')

const token = 'a'.repeat(64)

function snapshot() {
  return {
    schemaVersion: 1,
    operations: [{
      operationId: 'operation-1',
      kind: 'save-entry',
      contractVersion: 2,
      scope: 'time-entry:9',
      state: 'prepared',
      baseToken: token,
      expectedToken: token,
      accessToken: 'oauth-secret',
      authorization: 'Bearer secret',
      requestHeader: { Authorization: 'Bearer nested-secret' },
      rawResponse: '{"private":true}',
      draft: { note: 'safe', refreshToken: 'refresh-secret' }
    }],
    records: {
      'time-entry:9': {
        contractVersion: 2,
        kind: 'time-entry',
        id: '9',
        exists: true,
        note: 'safe',
        token,
        rawResponse: { private: true }
      }
    },
    errors: [{ code: 'not-durable' }],
    runtimeOnly: true
  }
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
  assert.equal(persisted.operations[0].draft.refreshToken, undefined)
  assert.equal(persisted.records['time-entry:9'].rawResponse, undefined)
  assert.equal(/oauth-secret|Bearer|refresh-secret|private/.test(serialized), false)
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

test('unsupported input preserves unread text and has no effects', () => {
  const raw = JSON.stringify({ schemaVersion: 2, operations: [], records: {} })
  const restored = Store.deserialize(raw)

  assert.equal(restored.snapshot, null)
  assert.equal(restored.recoveryError.code, 'LEDGER_SCHEMA_UNSUPPORTED')
  assert.equal(restored.unreadText, raw)
  assert.deepEqual(restored.effects, [])
})
