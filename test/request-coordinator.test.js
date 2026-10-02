const test = require('node:test')
const assert = require('node:assert/strict')

const Coordinator = require('../RequestCoordinator.js')

const budgets = { read: 64000, 'single-write': 128000, 'multi-segment': 320000, log: 192000, switch: 320000 }

function effect(id, overrides = {}) {
  return {
    effectId: `effect-${id}`,
    operationId: null,
    requestId: id,
    scope: null,
    requestKind: 'quiet-read',
    priority: 4,
    queryKey: `query-${id}`,
    coverage: null,
    causalTag: `cause-${id}`,
    commandClass: 'read',
    argv: ['read', id],
    ...overrides
  }
}

function enqueue(state, request) {
  return Coordinator.apply(state, { type: 'enqueue', effect: request })
}

function finish(state, request, type = 'adapter-succeeded') {
  return Coordinator.apply(state, {
    type,
    requestId: request.requestId,
    causalTag: request.causalTag,
    data: { ok: true }
  })
}

test('capacity never exceeds one', () => {
  let state = Coordinator.initialState(budgets)
  const first = effect('first')
  const second = effect('second')
  let result = enqueue(state, first)
  assert.deepEqual(result.actions.map(action => action.type), ['start'])
  state = result.state
  result = enqueue(state, second)
  assert.equal(result.actions.filter(action => action.type === 'start').length, 0)
  assert.equal(result.state.active.requestId, 'first')
  result = finish(result.state, first)
  assert.deepEqual(result.actions.map(action => action.type), ['complete', 'start'])
  assert.equal(result.actions[0].outcome, 'observation')
  assert.equal(result.state.active.requestId, 'second')
})

test('interactive mutation outranks queued reads', () => {
  let state = Coordinator.initialState(budgets)
  const active = effect('active', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-0', scope: 'time-entry:0', commandClass: 'single-write' })
  state = enqueue(state, active).state
  state = enqueue(state, effect('read', {
    requestKind: 'visible-read',
    priority: 3,
    scope: 'time-entry:1'
  })).state
  const mutation = effect('mutation', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-1', scope: 'time-entry:1', commandClass: 'single-write' })
  const enqueued = enqueue(state, mutation)
  assert.equal(enqueued.state.queue.some(request => request.requestId === 'read'), false)
  assert.equal(enqueued.actions.some(action => action.request && action.request.requestId === 'read'), true)
  state = enqueued.state
  const result = finish(state, active)
  assert.equal(result.actions[1].request.requestId, 'mutation')
})

test('active mutation is never canceled', () => {
  let state = Coordinator.initialState(budgets)
  const active = effect('active', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-1', scope: 'time-entry:1', commandClass: 'single-write' })
  state = enqueue(state, active).state
  const result = enqueue(state, effect('next-mutation', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-2', scope: 'time-entry:2', commandClass: 'single-write' }))
  assert.equal(result.actions.some(action => action.type === 'cancel-read'), false)
  assert.equal(result.state.active.requestId, 'active')
})

test('interactive mutation cancels active read and ignores its completion', () => {
  let state = Coordinator.initialState(budgets)
  const read = effect('read')
  state = enqueue(state, read).state
  const mutation = effect('mutation', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-1', scope: 'time-entry:1', commandClass: 'single-write' })
  let result = enqueue(state, mutation)
  assert.deepEqual(result.actions.map(action => action.type), ['cancel-read'])
  assert.equal(result.state.active.canceled, true)
  result = finish(result.state, read)
  assert.deepEqual(result.actions.map(action => action.type), ['drop', 'start'])
  assert.equal(result.state.active.requestId, 'mutation')
})

test('equivalent quiet reads coalesce', () => {
  let state = Coordinator.initialState(budgets)
  state = enqueue(state, effect('blocker', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-0', scope: 'time-entry:0', commandClass: 'single-write' })).state
  state = enqueue(state, effect('old', { queryKey: 'recent' })).state
  const result = enqueue(state, effect('new', { queryKey: 'recent' }))
  assert.equal(result.state.queue.some(request => request.requestId === 'old'), false)
  assert.equal(result.state.queue.some(request => request.requestId === 'new'), true)
  assert.deepEqual(result.actions.map(action => action.type), ['drop'])
})

test('newer complete broad read supersedes covered narrow read', () => {
  let state = Coordinator.initialState(budgets)
  state = enqueue(state, effect('blocker', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-0', scope: 'time-entry:0', commandClass: 'single-write' })).state
  state = enqueue(state, effect('day', { queryKey: 'entries:2026-09-02', coverage: { kind: 'time-entry', from: '2026-09-02', to: '2026-09-02', complete: true, includesDeleted: true } })).state
  const result = enqueue(state, effect('month', { queryKey: 'entries:september', coverage: { kind: 'time-entry', from: '2026-09-01', to: '2026-09-30', complete: true, includesDeleted: true } }))
  assert.equal(result.state.queue.some(request => request.requestId === 'day'), false)
  assert.equal(result.actions[0].reason, 'superseded')
})

test('does not subsume deletion-sensitive reconciliation with an incomplete broad read', () => {
  let state = Coordinator.initialState(budgets)
  state = enqueue(state, effect('blocker', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-0', scope: 'time-entry:0', commandClass: 'single-write' })).state
  state = enqueue(state, effect('reconcile', { requestKind: 'reconciliation', priority: 2, queryKey: 'entry:9', scope: 'time-entry:9', coverage: { kind: 'time-entry', from: '2026-09-02', to: '2026-09-02', complete: true, includesDeleted: true } })).state
  const result = enqueue(state, effect('broad', { requestKind: 'visible-read', priority: 3, queryKey: 'entries:september', coverage: { kind: 'time-entry', from: '2026-09-01', to: '2026-09-30', complete: false, includesDeleted: false } }))
  assert.equal(result.state.queue.some(request => request.requestId === 'reconcile'), true)
})

test('overlapping scope preserves causal order', () => {
  let state = Coordinator.initialState(budgets)
  const active = effect('active', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-0', scope: 'time-entry:0', commandClass: 'single-write' })
  state = enqueue(state, active).state
  state = enqueue(state, effect('older', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-1', scope: 'time-entry:9', commandClass: 'single-write' })).state
  state = enqueue(state, effect('newer', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-2', scope: 'time-entry:9', commandClass: 'single-write' })).state
  const result = finish(state, active)
  assert.equal(result.actions[1].request.requestId, 'older')
})

test('unknown reconciliation removes duplicate queued effects only for its scope', () => {
  let state = Coordinator.initialState(budgets)
  state = enqueue(state, effect('blocker', {
    requestKind: 'mutation', priority: 1, queryKey: null,
    operationId: 'operation-0', scope: 'time-entry:0', commandClass: 'single-write'
  })).state
  state = enqueue(state, effect('duplicate', {
    requestKind: 'mutation', priority: 1, queryKey: null,
    operationId: 'operation-1', scope: 'time-entry:9', commandClass: 'single-write'
  })).state
  state = enqueue(state, effect('unrelated', {
    requestKind: 'mutation', priority: 1, queryKey: null,
    operationId: 'operation-2', scope: 'time-entry:10', commandClass: 'single-write'
  })).state
  const result = enqueue(state, effect('reconcile', {
    requestKind: 'reconciliation', priority: 2, queryKey: 'entry:9',
    operationId: 'operation-1', scope: 'time-entry:9',
    coverage: { kind: 'time-entry', complete: true, includesDeleted: true }
  }))
  assert.equal(result.state.queue.some(request => request.requestId === 'duplicate'), false)
  assert.equal(result.state.queue.some(request => request.requestId === 'unrelated'), true)
  assert.equal(result.actions.some(action => action.request && action.request.requestId === 'duplicate'), true)
})
test('classified adapter failure preserves unknown mutation outcome', () => {
  let state = Coordinator.initialState(budgets)
  const mutation = effect('failed', {
    requestKind: 'mutation', priority: 1, queryKey: null,
    operationId: 'operation-1', scope: 'time-entry:9', commandClass: 'single-write'
  })
  state = enqueue(state, mutation).state
  const result = Coordinator.apply(state, {
    type: 'adapter-failed',
    requestId: mutation.requestId,
    causalTag: mutation.causalTag,
    outcome: 'unknown',
    error: { code: 'INVALID_RESPONSE' }
  })
  assert.equal(result.actions[0].outcome, 'unknown')
})


test('outer deadline exceeds advertised class budget and reports mutation unknown', () => {
  let state = Coordinator.initialState(budgets)
  const mutation = effect('switch', { requestKind: 'mutation', priority: 1, queryKey: null, operationId: 'operation-1', scope: 'active-timer:1', commandClass: 'switch' })
  let result = enqueue(state, mutation)
  assert.equal(result.actions[0].deadlineMs, 323000)
  state = result.state
  result = Coordinator.apply(state, { type: 'deadline', requestId: 'switch', causalTag: 'cause-switch' })
  assert.equal(result.actions[0].type, 'complete')
  assert.equal(result.actions[0].outcome, 'unknown')
  assert.equal(result.actions.some(action => action.type === 'start'), false)
})
