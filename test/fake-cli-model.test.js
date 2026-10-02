const test = require('node:test')
const assert = require('node:assert/strict')
const fake = require('../FakeCliModel.js')

test('consumes exact request tags and scripted CLI outcomes deterministically', () => {
  const script = [
    {
      requestKind: 'quiet-read',
      scope: null,
      outcome: 'observation',
      data: { records: [{ id: '42' }] }
    },
    {
      requestKind: 'mutation',
      scope: 'active-timer:42',
      outcome: 'known-error',
      error: { code: 'GUARD_REJECTED', message: 'Changed elsewhere' }
    }
  ]

  const first = fake.consume(script, {
    requestKind: 'quiet-read',
    scope: null,
    outcome: 'observation'
  })
  assert.deepEqual(first.result, {
    ok: true,
    completion: { outcome: 'observation', data: { records: [{ id: '42' }] } }
  })
  assert.equal(first.remaining.length, 1)

  const second = fake.consume(first.remaining, {
    requestKind: 'mutation',
    scope: 'active-timer:42',
    outcome: 'known-error'
  })
  assert.deepEqual(second.result.completion, {
    outcome: 'known-error',
    error: { code: 'GUARD_REJECTED', message: 'Changed elsewhere' }
  })
  assert.equal(second.remaining.length, 0)
})

test('mismatch reports exact expected and actual tags', () => {
  const mismatch = fake.consume([
    { requestKind: 'mutation', scope: 'active-timer:42', outcome: 'receipt', data: {} }
  ], {
    requestKind: 'quiet-read', scope: null, outcome: 'observation'
  })
  assert.equal(mismatch.result.ok, false)
  assert.equal(mismatch.result.error.code, 'FAKE_UNEXPECTED_REQUEST')
  assert.deepEqual(mismatch.result.error.expected, {
    requestKind: 'mutation', scope: 'active-timer:42', outcome: 'receipt'
  })
  assert.deepEqual(mismatch.result.error.actual, {
    requestKind: 'quiet-read', scope: null, outcome: 'observation'
  })

  const exhausted = fake.consume([], {
    requestKind: 'quiet-read', scope: null, outcome: 'observation'
  })
  assert.equal(exhausted.result.error.code, 'FAKE_SCRIPT_EXHAUSTED')
})

test('queue exposes deterministic start cancellation and late completion', () => {
  let state = fake.initialState([{
    requestKind: 'quiet-read', scope: null, outcome: 'observation', data: { records: [] }
  }])
  state = fake.enqueue(state, { requestId: 'read-1', requestKind: 'quiet-read', scope: null }).state
  let transition = fake.startNext(state)
  state = transition.state
  assert.equal(transition.started.requestId, 'read-1')

  transition = fake.cancelRead(state, 'read-1')
  state = transition.state
  assert.equal(transition.canceled, true)

  transition = fake.completeActive(state)
  assert.equal(transition.completion.requestId, 'read-1')
  assert.equal(transition.completion.canceled, true)
  assert.equal(transition.completion.outcome, 'observation')
})
