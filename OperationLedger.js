var SCHEMA_VERSION = 1
var LOCKING_STATES = ["prepared", "in-flight", "rebasing", "conflicted", "unknown"]

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) {
    var array = new Array(value.length)
    for (var i = 0; i < value.length; i++) array[i] = clone(value[i])
    return array
  }
  if (!isObject(value)) return value
  var result = {}
  var keys = Object.keys(value)
  for (var j = 0; j < keys.length; j++) result[keys[j]] = clone(value[keys[j]])
  return result
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
  var keys = Object.keys(value)
  for (var i = 0; i < keys.length; i++) deepFreeze(value[keys[i]])
  return Object.freeze(value)
}

function recordScope(record) {
  return record.kind + ":" + record.id
}

function recordsByScope(records) {
  var result = {}
  if (Array.isArray(records)) {
    for (var i = 0; i < records.length; i++) result[recordScope(records[i])] = clone(records[i])
    return result
  }
  if (isObject(records)) {
    var scopes = Object.keys(records)
    for (var j = 0; j < scopes.length; j++) result[scopes[j]] = clone(records[scopes[j]])
  }
  return result
}

function defaultGenerator(start) {
  var sequence = start || 0
  return function() { sequence += 1; return sequence }
}

function maximumSequence(operations) {
  var maximum = 0
  for (var i = 0; i < operations.length; i++) {
    var match = /^operation-(\d+)$/.exec(operations[i].operationId || "")
    if (match) maximum = Math.max(maximum, Number(match[1]))
  }
  return maximum
}

function initialState(options) {
  options = options || {}
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    operations: [],
    records: recordsByScope(options.records || {}),
    errors: [],
    _lastOperationSequence: 0,
    _nextOperationSequence: options.nextOperationSequence || defaultGenerator(0)
  }
}

function restore(snapshot, options) {
  if (!isObject(snapshot) || snapshot.schemaVersion !== SCHEMA_VERSION
      || !Array.isArray(snapshot.operations) || !isObject(snapshot.records)) return null
  var operations = clone(snapshot.operations)
  var sequence = maximumSequence(operations)
  options = options || {}
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    operations: operations,
    records: recordsByScope(snapshot.records),
    errors: [],
    _lastOperationSequence: sequence,
    _nextOperationSequence: options.nextOperationSequence || defaultGenerator(sequence)
  }
}

function cloneState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: state.revision,
    operations: clone(state.operations),
    records: clone(state.records),
    errors: clone(state.errors),
    _lastOperationSequence: state._lastOperationSequence,
    _nextOperationSequence: state._nextOperationSequence
  }
}

function durableSnapshot(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    operations: clone(state.operations),
    records: clone(state.records)
  }
}

function activeOperationForScope(state, scope) {
  for (var i = state.operations.length - 1; i >= 0; i--) {
    var operation = state.operations[i]
    if (operation.scope === scope && LOCKING_STATES.indexOf(operation.state) !== -1) return operation
  }
  return null
}

function buildView(state) {
  var operations = []
  var conflicts = []
  var scopes = {}
  var recordScopes = Object.keys(state.records)
  for (var i = 0; i < recordScopes.length; i++) scopes[recordScopes[i]] = true
  for (var j = 0; j < state.operations.length; j++) {
    var operation = state.operations[j]
    scopes[operation.scope] = true
    operations.push({
      operationId: operation.operationId,
      scope: operation.scope,
      state: operation.state,
      draftAvailable: operation.draft !== null && operation.draft !== undefined
    })
    if (operation.state === "conflicted") conflicts.push(clone(operation.conflict))
  }
  var actions = {}
  var allScopes = Object.keys(scopes)
  for (var k = 0; k < allScopes.length; k++) {
    var scope = allScopes[k]
    var active = activeOperationForScope(state, scope)
    actions[scope] = {
      canMutate: active === null,
      canOpenDraft: active !== null && active.draft !== null && active.draft !== undefined,
      canResolve: active !== null && active.state === "conflicted",
      canNavigate: true
    }
  }
  return deepFreeze({
    revision: state.revision,
    records: clone(state.records),
    operations: operations,
    conflicts: conflicts,
    errors: clone(state.errors),
    actions: actions
  })
}

function result(state, effects) {
  return { state: state, effects: effects || [], view: buildView(state) }
}

function nextOperationId(state) {
  var generated = Number(state._nextOperationSequence())
  if (!isFinite(generated) || Math.floor(generated) !== generated
      || generated <= state._lastOperationSequence) generated = state._lastOperationSequence + 1
  state._lastOperationSequence = generated
  return "operation-" + generated
}

function applyPatch(base, patch) {
  var intended = clone(base || {})
  patch = patch || {}
  var groups = Object.keys(patch)
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i]
    var value = patch[group]
    if (group === "duration") intended.durationSeconds = isObject(value) ? value.durationSeconds : value
    else if (group === "date" && isObject(value)) {
      if (value.localDate !== undefined) intended.localDate = clone(value.localDate)
      if (value.startedAt !== undefined) intended.startedAt = clone(value.startedAt)
    } else if (group === "assignment" && isObject(value)) {
      var assignmentKeys = ["projectId", "serviceId", "clientId", "billable"]
      for (var j = 0; j < assignmentKeys.length; j++) {
        var key = assignmentKeys[j]
        if (value[key] !== undefined) intended[key] = clone(value[key])
      }
    } else if (group === "timer-state" && isObject(value)) {
      var stateKeys = Object.keys(value)
      for (var k = 0; k < stateKeys.length; k++) intended[stateKeys[k]] = clone(value[stateKeys[k]])
    } else intended[group] = clone(value)
  }
  return intended
}

function provisionalClass(intent) {
  if (intent.type === "save-entry") return "time-entry-create"
  if (intent.type === "start") return "active-timer-create"
  if (intent.type === "switch") return "timer-switch-target"
  return null
}

function requestFor(operation) {
  var request = operation.request
  var effect = {
    type: "request",
    effectId: "effect-request-" + operation.operationId.slice("operation-".length),
    operationId: operation.operationId,
    requestId: request.requestId,
    scope: operation.scope,
    requestKind: "mutation",
    priority: 1,
    queryKey: null,
    coverage: null,
    causalTag: operation.causalTag,
    commandClass: request.commandClass,
    argv: clone(request.argv)
  }
  if (request.stdin !== undefined) effect.stdin = request.stdin
  return effect
}

function prepareIntent(state, intent) {
  if (!isObject(intent) || typeof intent.type !== "string") return result(state, [])
  var next = cloneState(state)
  var operationId = nextOperationId(next)
  var scope = intent.scope
  if (!scope) {
    var creationClass = provisionalClass(intent)
    if (!creationClass) return result(state, [])
    scope = "provisional:" + operationId + ":" + creationClass
  }
  if (activeOperationForScope(next, scope)) return result(state, [])
  var base = intent.base === undefined ? next.records[scope] || null : intent.base
  var intended = intent.intended === undefined ? applyPatch(base, intent.patch) : clone(intent.intended)
  var sequence = operationId.slice("operation-".length)
  var operation = {
    operationId: operationId,
    kind: intent.type,
    scope: scope,
    contractVersion: intent.baseContractVersion || 2,
    base: clone(base),
    baseToken: intent.baseToken === undefined ? (base && base.token || null) : intent.baseToken,
    patch: clone(intent.patch || {}),
    intended: intended,
    projection: clone(intended),
    draft: clone(intent.draft || {}),
    state: "prepared",
    causalTag: intent.causalTag || "cause-" + sequence,
    request: {
      requestId: intent.requestId || "request-" + sequence,
      commandClass: intent.commandClass || "single-write",
      argv: clone(intent.argv || []),
      stdin: intent.stdin
    },
    receipt: null,
    lineage: intent.lineage || null
  }
  next.operations.push(operation)
  next.records[scope] = clone(intended)
  next.revision += 1
  return result(next, [{
    type: "persist",
    transactionId: operationId,
    snapshot: durableSnapshot(next)
  }])
}

function operationByTransaction(state, transactionId) {
  for (var i = state.operations.length - 1; i >= 0; i--) {
    var operation = state.operations[i]
    if (operation.operationId === transactionId
        || "started-" + operation.operationId === transactionId
        || "settlement-" + operation.operationId === transactionId) return operation
  }
  return null
}

function persisted(state, event) {
  var operation = operationByTransaction(state, event.transactionId)
  if (!operation) return result(state, [])
  if (event.transactionId === operation.operationId && operation.state === "prepared")
    return result(state, [requestFor(operation)])
  if (event.transactionId === "settlement-" + operation.operationId
      && operation.state === "in-flight" && operation.pendingSettlement) {
    var next = cloneState(state)
    var settled = operationByTransaction(next, event.transactionId)
    applySettlement(next, settled, settled.pendingSettlement)
    next.revision += 1
    return result(next, [{ type: "compact", operationId: settled.operationId }])
  }
  return result(state, [])
}

function requestStarted(state, event) {
  var next = cloneState(state)
  for (var i = 0; i < next.operations.length; i++) {
    var operation = next.operations[i]
    if (operation.operationId === event.operationId && operation.state === "prepared") {
      operation.state = "in-flight"
      operation.request.requestId = event.requestId || operation.request.requestId
      next.revision += 1
      return result(next, [{
        type: "persist",
        transactionId: "started-" + operation.operationId,
        snapshot: durableSnapshot(next)
      }])
    }
  }
  return result(state, [])
}

function receiptCovers(operation, receipt) {
  if (!isObject(receipt) || !Array.isArray(receipt.changes) || !Array.isArray(receipt.results)) return false
  for (var i = 0; i < receipt.changes.length; i++) {
    if (receipt.changes[i].scope === operation.scope) return true
  }
  if (operation.scope.indexOf("provisional:") !== 0) return false
  var expected = operation.scope.split(":")[2]
  var mutationMatches = expected === "time-entry-create" && receipt.mutationKind === "time-entry-create"
    || expected === "active-timer-create" && receipt.mutationKind === "timer-start"
    || expected === "timer-switch-target" && receipt.mutationKind === "timer-switch"
  if (!mutationMatches) return false
  for (var j = 0; j < receipt.changes.length; j++) {
    var change = receipt.changes[j]
    if (change.before && change.before.absent === true) return true
  }
  return false
}

function applySettlement(state, operation, receipt) {
  for (var i = 0; i < receipt.results.length; i++) {
    var record = receipt.results[i]
    var scope = recordScope(record)
    if (record.exists === false) delete state.records[scope]
    else state.records[scope] = clone(record)
  }
  if (operation.scope.indexOf("provisional:") === 0) delete state.records[operation.scope]
  operation.state = "settled"
  operation.draft = null
  operation.projection = null
  operation.receipt = clone(receipt)
  delete operation.pendingSettlement
}

function settleReceipt(state, event) {
  var next = cloneState(state)
  var operation = null
  for (var i = 0; i < next.operations.length; i++)
    if (next.operations[i].operationId === event.operationId) operation = next.operations[i]
  if (!operation || operation.state !== "in-flight" || operation.pendingSettlement
      || !receiptCovers(operation, event.data)) return result(state, [])
  operation.pendingSettlement = clone(event.data)
  var durable = cloneState(next)
  var durableOperation = operationByTransaction(durable, "settlement-" + operation.operationId)
  applySettlement(durable, durableOperation, event.data)
  durable.revision += 1
  return result(next, [{
    type: "persist",
    transactionId: "settlement-" + operation.operationId,
    snapshot: durableSnapshot(durable)
  }])
}

function persistenceFailed(state, event) {
  var operation = operationByTransaction(state, event.transactionId)
  if (!operation) return result(state, [])
  var next = cloneState(state)
  next.errors.push({
    code: "LEDGER_WRITE_FAILED",
    message: String(event.error && event.error.message || event.error || "Ledger persistence failed"),
    operationId: operation.operationId,
    scope: operation.scope,
    persistent: true
  })
  next.revision += 1
  return result(next, [])
}

function apply(state, event) {
  if (!state) state = initialState()
  if (!event || typeof event.type !== "string") return result(state, [])
  if (event.type === "intent") return prepareIntent(state, event.intent)
  if (event.type === "persisted") return persisted(state, event)
  if (event.type === "request-started") return requestStarted(state, event)
  if (event.type === "completion" && event.outcome === "receipt") return settleReceipt(state, event)
  if (event.type === "persistence-failed") return persistenceFailed(state, event)
  return result(state, [])
}

if (typeof module !== "undefined") module.exports = {
  initialState: initialState,
  restore: restore,
  apply: apply
}
