var DEFAULT_BUDGETS = {
  read: 64000,
  "single-write": 128000,
  "multi-segment": 320000,
  log: 192000,
  switch: 320000
}

function clone(value) {
  if (value === null || value === undefined || typeof value !== "object") return value
  if (Array.isArray(value)) {
    var array = new Array(value.length)
    for (var i = 0; i < value.length; i++) array[i] = clone(value[i])
    return array
  }
  var object = {}
  var keys = Object.keys(value)
  for (var j = 0; j < keys.length; j++) object[keys[j]] = clone(value[keys[j]])
  return object
}

function initialState(budgets) {
  var configured = {}
  var classes = Object.keys(DEFAULT_BUDGETS)
  budgets = budgets || {}
  for (var i = 0; i < classes.length; i++) {
    var name = classes[i]
    configured[name] = Number(budgets[name] === undefined ? DEFAULT_BUDGETS[name] : budgets[name])
  }
  return { budgets: configured, active: null, queue: [], nextSequence: 1, latestQueries: {} }
}

function copyState(state) {
  return {
    budgets: state.budgets,
    active: state.active ? clone(state.active) : null,
    queue: clone(state.queue),
    nextSequence: state.nextSequence,
    latestQueries: clone(state.latestQueries)
  }
}

function isRead(request) { return request.requestKind !== "mutation" }

function validEffect(effect) {
  return effect && typeof effect.requestId === "string"
    && typeof effect.requestKind === "string"
    && typeof effect.priority === "number"
    && typeof effect.commandClass === "string"
}

function startAction(state, request) {
  var budget = state.budgets[request.commandClass]
  if (!(budget >= 0)) budget = state.budgets.read
  return { type: "start", request: clone(request), deadlineMs: budget + 3000 }
}

function before(left, right) {
  if (left.priority !== right.priority) return left.priority < right.priority
  return left.enqueueSequence < right.enqueueSequence
}

function takeNext(state, actions) {
  if (state.active || state.queue.length === 0) return
  var selected = 0
  for (var i = 1; i < state.queue.length; i++)
    if (before(state.queue[i], state.queue[selected])) selected = i
  state.active = state.queue.splice(selected, 1)[0]
  if (state.active.queryKey)
    state.latestQueries[state.active.queryKey] = state.active.enqueueSequence
  actions.push(startAction(state, state.active))
}

function sameQuery(left, right) {
  return isRead(left) && isRead(right) && left.queryKey !== null
    && left.queryKey !== undefined && left.queryKey === right.queryKey
}

function equivalentActiveRead(newer, active) {
  return active && !active.canceled && isRead(newer) && isRead(active)
    && sameQuery(newer, active)
    && newer.requestKind === active.requestKind
    && newer.operationId === active.operationId
    && newer.responseKind === active.responseKind
}

function covers(broad, narrow) {
  if (!broad || !narrow || broad.kind !== narrow.kind || broad.complete !== true) return false
  if (narrow.includesDeleted === true && broad.includesDeleted !== true) return false
  if (narrow.identity) {
    if (broad.identity) return broad.identity === narrow.identity
    if (!narrow.from || !narrow.to) return false
  } else if (broad.identity) return false
  if (narrow.from && (!broad.from || broad.from > narrow.from)) return false
  if (narrow.to && (!broad.to || broad.to < narrow.to)) return false
  return true
}

function canSupersede(newer, older) {
  if (!isRead(newer) || !isRead(older)) return false
  if (older.requestKind === "reconciliation"
      && (newer.requestKind !== "reconciliation"
        || newer.operationId !== older.operationId)) return false
  return sameQuery(newer, older) || covers(newer.coverage, older.coverage)
}

function dropQueuedReads(state, request, actions) {
  if (!isRead(request)) return
  for (var i = state.queue.length - 1; i >= 0; i--) {
    var queued = state.queue[i]
    if (!isRead(queued)) continue
    if (!canSupersede(request, queued)) continue
    state.queue.splice(i, 1)
    actions.push({ type: "drop", request: clone(queued), reason: "superseded" })
  }
}

function matchingActive(state, event) {
  return state.active && state.active.requestId === event.requestId
    && (event.causalTag === undefined || state.active.causalTag === event.causalTag)
}

function completionAction(request, event, outcome) {
  var action = {
    type: "complete",
    request: clone(request),
    operationId: request.operationId,
    requestId: request.requestId,
    scope: request.scope,
    causalTag: request.causalTag,
    outcome: outcome
  }
  if (event.data !== undefined) action.data = clone(event.data)
  if (event.error !== undefined) action.error = clone(event.error)
  return action
}

function dropMutationReads(state, request, actions) {
  if (request.requestKind !== "mutation" || request.scope === null) return
  for (var i = state.queue.length - 1; i >= 0; i--) {
    var queued = state.queue[i]
    if (!isRead(queued) || queued.scope !== request.scope) continue
    state.queue.splice(i, 1)
    actions.push({ type: "drop", request: clone(queued), reason: "superseded-by-mutation" })
  }
}

function dropAffectedDuplicates(state, request, actions) {
  if (request.requestKind !== "reconciliation" || request.scope === null) return
  for (var i = state.queue.length - 1; i >= 0; i--) {
    var queued = state.queue[i]
    if (queued.scope !== request.scope) continue
    if (queued.operationId !== request.operationId && queued.requestKind === "mutation") continue
    state.queue.splice(i, 1)
    actions.push({ type: "drop", request: clone(queued), reason: "unknown-outcome" })
  }
}

function finish(state, event, outcome) {
  var next = copyState(state)
  var actions = []
  if (!matchingActive(next, event)) {
    actions.push({ type: "drop", requestId: event.requestId, reason: "stale-completion" })
    return { state: next, actions: actions }
  }
  var request = next.active
  next.active = null
  if (request.canceled) actions.push({ type: "drop", request: clone(request), reason: "canceled" })
  else {
    if (request.queryKey && next.latestQueries[request.queryKey] !== undefined
        && next.latestQueries[request.queryKey] !== request.enqueueSequence)
      actions.push({ type: "drop", request: clone(request), reason: "superseded" })
    else actions.push(completionAction(request, event, outcome))
  }
  takeNext(next, actions)
  return { state: next, actions: actions }
}

function enqueue(state, event) {
  var next = copyState(state)
  var actions = []
  if (!validEffect(event.effect)) return { state: state, actions: actions }
  var request = clone(event.effect)
  request.enqueueSequence = next.nextSequence++
  request.canceled = false
  if (equivalentActiveRead(request, next.active)) {
    actions.push({ type: "drop", request: clone(request), reason: "coalesced-active" })
    return { state: next, actions: actions }
  }
  var protectsReconciliation = false
  if (isRead(request)) {
    if (next.active && sameQuery(request, next.active)
        && !canSupersede(request, next.active)) protectsReconciliation = true
    for (var i = 0; i < next.queue.length; i++)
      if (sameQuery(request, next.queue[i])
          && !canSupersede(request, next.queue[i])) protectsReconciliation = true
  }
  if (isRead(request) && request.queryKey && !protectsReconciliation)
    next.latestQueries[request.queryKey] = request.enqueueSequence
  dropMutationReads(next, request, actions)
  dropAffectedDuplicates(next, request, actions)
  dropQueuedReads(next, request, actions)
  next.queue.push(request)
  if (request.requestKind === "mutation" && next.active && isRead(next.active)
      && !next.active.canceled) {
    next.active.canceled = true
    actions.push({ type: "cancel-read", request: clone(next.active), reason: "interactive-mutation" })
  }
  takeNext(next, actions)
  return { state: next, actions: actions }
}

function deadline(state, event) {
  if (!matchingActive(state, event))
    return { state: state, actions: [{ type: "drop", requestId: event.requestId, reason: "stale-deadline" }] }
  if (isRead(state.active)) {
    var waiting = copyState(state)
    if (waiting.active.canceled) return { state: waiting, actions: [] }
    waiting.active.canceled = true
    return { state: waiting, actions: [{ type: "cancel-read", request: clone(waiting.active), reason: "deadline" }] }
  }
  return finish(state, event, "unknown")
}

function exited(state, event) {
  if (!matchingActive(state, event))
    return { state: state, actions: [{ type: "drop", requestId: event.requestId, reason: "stale-exit" }] }
  if (state.active.canceled) return finish(state, event, "canceled")
  return finish(state, event, isRead(state.active) ? "known-error" : "unknown")
}

function apply(state, event) {
  if (!state) state = initialState()
  if (!event || typeof event.type !== "string") return { state: state, actions: [] }
  if (event.type === "enqueue") return enqueue(state, event)
  if (event.type === "adapter-started") return { state: state, actions: [] }
  if (event.type === "adapter-succeeded")
    return finish(state, event, state.active && state.active.requestKind === "mutation"
      ? "receipt" : "observation")
  if (event.type === "adapter-failed")
    return finish(state, event, event.outcome === "unknown" ? "unknown" : "known-error")
  if (event.type === "adapter-exited") return exited(state, event)
  if (event.type === "deadline") return deadline(state, event)
  return { state: state, actions: [] }
}

if (typeof module !== "undefined") module.exports = {
  initialState: initialState,
  apply: apply
}
