const test = require('node:test')
const assert = require('node:assert/strict')
const fake = require('../FakeCliModel.js')

test('consumes scripted CLI outcomes deterministically', () => {
  const script = [
    { intent: 'refreshTimers', data: [{ id: 42, running: true }] },
    { intent: 'pause', ok: false, error: { code: 'REMOTE_CHANGED', message: 'Changed elsewhere' } }
  ]

  const first = fake.consume(script, { intent: 'refreshTimers' })
  assert.deepEqual(first.result, { ok: true, data: [{ id: 42, running: true }] })
  assert.equal(first.remaining.length, 1)

  const second = fake.consume(first.remaining, { intent: 'pause' })
  assert.deepEqual(second.result, {
    ok: false,
    error: { code: 'REMOTE_CHANGED', message: 'Changed elsewhere' }
  })
  assert.equal(second.remaining.length, 0)
})

test('fails loudly when the fake receives an unexpected request', () => {
  const mismatch = fake.consume([{ intent: 'log', data: {} }], { intent: 'start' })
  assert.equal(mismatch.result.ok, false)
  assert.equal(mismatch.result.error.code, 'FAKE_UNEXPECTED_INTENT')

  const exhausted = fake.consume([], { intent: 'refreshTimers' })
  assert.equal(exhausted.result.error.code, 'FAKE_SCRIPT_EXHAUSTED')
})
