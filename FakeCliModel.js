function copy(value) {
  if (value === null || value === undefined || typeof value !== "object") return value
  if (Array.isArray(value)) {
    var array = new Array(value.length)
    for (var i = 0; i < value.length; i++) array[i] = copy(value[i])
    return array
  }
  var object = {}
  var keys = Object.keys(value)
  for (var j = 0; j < keys.length; j++) object[keys[j]] = copy(value[keys[j]])
  return object
}

function tags(value) {
  value = value || {}
  return {
    requestKind: value.requestKind === undefined ? null : value.requestKind,
    scope: value.scope === undefined ? null : value.scope,
    outcome: value.outcome === undefined ? null : value.outcome
  }
}

function sameTags(left, right) {
  return left.requestKind === right.requestKind
    && left.scope === right.scope
    && left.outcome === right.outcome
}

function consume(script, actualValue) {
  var remaining = Array.isArray(script) ? copy(script) : []
  if (remaining.length === 0) {
    return {
      remaining: remaining,
      result: {
        ok: false,
        error: { code: "FAKE_SCRIPT_EXHAUSTED", message: "No fake response was configured" }
      }
    }
  }

  var step = remaining.shift() || {}
  var expected = tags(step)
  var actual = tags(actualValue)
  if (!sameTags(expected, actual)) {
    return {
      remaining: remaining,
      result: {
        ok: false,
        error: {
          code: "FAKE_UNEXPECTED_REQUEST",
          message: "Fake request tags did not match the next scripted step",
          expected: expected,
          actual: actual
        }
      }
    }
  }

  var completion = { outcome: step.outcome }
  if (step.data !== undefined) completion.data = copy(step.data)
  if (step.error !== undefined) completion.error = copy(step.error)
  return { remaining: remaining, result: { ok: true, completion: completion } }
}

function initialState(script) {
  return { script: Array.isArray(script) ? copy(script) : [], pending: [], active: null }
}

function copyState(state) {
  return {
    script: copy(state.script),
    pending: copy(state.pending),
    active: state.active ? copy(state.active) : null
  }
}

function enqueue(state, request) {
  var next = copyState(state)
  next.pending.push(copy(request || {}))
  return { state: next }
}

function startNext(state) {
  var next = copyState(state)
  if (next.active || next.pending.length === 0) return { state: next, started: null }
  next.active = { request: next.pending.shift(), canceled: false }
  return { state: next, started: copy(next.active.request) }
}

function cancelRead(state, requestId) {
  var next = copyState(state)
  if (!next.active || String(next.active.request.requestId || "") !== String(requestId || "")
      || next.active.request.requestKind === "mutation") return { state: next, canceled: false }
  next.active.canceled = true
  return { state: next, canceled: true }
}

function completeActive(state) {
  var next = copyState(state)
  if (!next.active) return { state: next, completion: null }
  var request = next.active.request
  var step = next.script.length > 0 ? next.script[0] : null
  var actual = {
    requestKind: request.requestKind,
    scope: request.scope,
    outcome: step ? step.outcome : null
  }
  var consumed = consume(next.script, actual)
  next.script = consumed.remaining
  next.active = null
  var completion
  if (consumed.result.ok) completion = consumed.result.completion
  else completion = { outcome: "known-error", error: consumed.result.error }
  var keys = Object.keys(request)
  for (var i = 0; i < keys.length; i++) completion[keys[i]] = copy(request[keys[i]])
  completion.canceled = state.active.canceled === true
  return { state: next, completion: completion }
}

if (typeof module !== "undefined") module.exports = {
  consume: consume,
  initialState: initialState,
  enqueue: enqueue,
  startNext: startNext,
  cancelRead: cancelRead,
  completeActive: completeActive
}
