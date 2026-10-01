var SCHEMA_VERSION = 1
var LOCKING_STATES = ["prepared", "in-flight", "rebasing", "conflicted", "unknown"]
var EDITABLE_GROUPS = ["note", "duration", "date", "assignment", "timer-state"]

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

function sameValue(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (var i = 0; i < left.length; i++) if (!sameValue(left[i], right[i])) return false
    return true
  }
  if (!isObject(left) || !isObject(right)) return false
  var leftKeys = Object.keys(left).sort()
  var rightKeys = Object.keys(right).sort()
  if (!sameValue(leftKeys, rightKeys)) return false
  for (var j = 0; j < leftKeys.length; j++)
    if (!sameValue(left[leftKeys[j]], right[leftKeys[j]])) return false
  return true
}

function structuralValue(record) {
  if (!record || record.exists === false) return { exists: false }
  if (record.kind !== "active-timer") return { exists: true }
  var segments = []
  for (var i = 0; i < record.segments.length; i++) {
    var segment = record.segments[i]
    segments.push({
      id: segment.id,
      timerId: segment.timerId,
      exists: segment.exists,
      startedAt: segment.startedAt,
      durationSeconds: segment.durationSeconds,
      running: segment.running,
      logged: segment.logged
    })
  }
  return {
    exists: true,
    state: record.state,
    segments: segments,
    elapsedAnchor: {
      closedSeconds: record.elapsedAnchor.closedSeconds,
      runningStartedAt: record.elapsedAnchor.runningStartedAt
    }
  }
}

function groupValue(record, group) {
  if (!record || record.exists === false) {
    if (group === "timer-state") return { exists: false }
    return undefined
  }
  if (group === "note") return record.note
  if (group === "duration")
    return record.kind === "active-timer" ? record.elapsedAnchor.closedSeconds : record.durationSeconds
  if (group === "date") return record.kind === "time-entry"
    ? { localDate: record.localDate, startedAt: record.startedAt } : undefined
  if (group === "assignment")
    return { projectId: record.projectId, serviceId: record.serviceId }
  if (group === "timer-state") return structuralValue(record)
  return undefined
}

function changedGroups(base, candidate) {
  var changed = []
  for (var i = 0; i < EDITABLE_GROUPS.length; i++) {
    var group = EDITABLE_GROUPS[i]
    if (!sameValue(groupValue(base, group), groupValue(candidate, group))) changed.push(group)
  }
  return changed
}

function copyGroup(target, source, group) {
  if (!source || source.exists === false) return clone(source)
  if (group === "note") target.note = source.note
  else if (group === "duration") {
    if (source.kind === "active-timer") target.elapsedAnchor.closedSeconds = source.elapsedAnchor.closedSeconds
    else target.durationSeconds = source.durationSeconds
  } else if (group === "date" && source.kind === "time-entry") {
    target.localDate = source.localDate
    target.startedAt = source.startedAt
  } else if (group === "assignment") {
    target.projectId = source.projectId
    target.serviceId = source.serviceId
  } else if (group === "timer-state") {
    if (source.kind === "active-timer") {
      target.state = source.state
      target.segments = clone(source.segments)
      target.elapsedAnchor = clone(source.elapsedAnchor)
    }
  }
  return target
}

function mergeThreeWay(base, intended, current) {
  var localChanges = changedGroups(base, intended)
  var remoteChanges = changedGroups(base, current)
  if (current && current.exists === false) {
    return {
      merged: localChanges.length === 0 ? clone(current) : clone(intended),
      conflicts: [],
      deletion: localChanges.length !== 0
    }
  }
  if (intended && intended.exists === false && remoteChanges.length !== 0) {
    return { merged: clone(intended), conflicts: ["timer-state"], deletion: false }
  }
  var merged = clone(current)
  var conflicts = []
  for (var i = 0; i < EDITABLE_GROUPS.length; i++) {
    var group = EDITABLE_GROUPS[i]
    var localChanged = localChanges.indexOf(group) !== -1
    var remoteChanged = remoteChanges.indexOf(group) !== -1
    if (!localChanged) continue
    if (!remoteChanged) merged = copyGroup(merged, intended, group)
    else if (!sameValue(groupValue(intended, group), groupValue(current, group))) {
      conflicts.push(group)
      merged = copyGroup(merged, intended, group)
    }
  }
  return { merged: merged, conflicts: conflicts, deletion: false }
}

function patchForGroups(record, groups) {
  var patch = {}
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i]
    var value = groupValue(record, group)
    if (group === "timer-state") {
      patch[group] = { state: value.exists === false ? "deleted" : value.state || "present" }
    } else patch[group] = clone(value)
  }
  return patch
}

function conflictFor(operation) {
  var deletion = operation.base && operation.base.exists === false
    && operation.intended && operation.intended.exists !== false
  var groups = []
  if (!deletion) {
    var names = Object.keys(operation.patch)
    for (var i = 0; i < EDITABLE_GROUPS.length; i++) {
      var group = EDITABLE_GROUPS[i]
      if (names.indexOf(group) !== -1) groups.push({
        group: group,
        mine: clone(groupValue(operation.intended, group)),
        freshbooks: clone(groupValue(operation.base, group))
      })
    }
  }
  return {
    operationId: operation.operationId,
    scope: operation.scope,
    groups: groups,
    deletion: deletion
  }
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
  var operations = clone(state.operations)
  for (var i = 0; i < operations.length; i++) {
    if (operations[i].state === "settled" && operations[i].receipt === null)
      operations[i].state = "superseded"
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    operations: operations,
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
    if (operation.state === "conflicted") conflicts.push(conflictFor(operation))
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

function operationById(state, operationId) {
  for (var i = state.operations.length - 1; i >= 0; i--)
    if (state.operations[i].operationId === operationId) return state.operations[i]
  return null
}

function guardedArgv(argv, token) {
  var result = []
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--guard") { i += 1; continue }
    result.push(argv[i])
  }
  if (token !== null && token !== undefined) {
    result.push("--guard")
    result.push(token)
  }
  return result
}

function publishRecord(state, scope, record) {
  if (!record || record.exists === false) delete state.records[scope]
  else state.records[scope] = clone(record)
}

function closeWithoutMutation(state, operation, current) {
  operation.pendingResolution = clone(current)
  var durable = cloneState(state)
  var durableOperation = operationById(durable, operation.operationId)
  durableOperation.state = "superseded"
  durableOperation.base = clone(current)
  durableOperation.baseToken = current && current.token || null
  durableOperation.intended = clone(current)
  durableOperation.projection = null
  durableOperation.draft = null
  durableOperation.patch = {}
  delete durableOperation.pendingResolution
  publishRecord(durable, durableOperation.scope, current)
  durable.revision += 1
  return result(state, [{
    type: "persist",
    transactionId: "resolution-" + operation.operationId,
    snapshot: durableSnapshot(durable)
  }])
}

function replacementOperation(state, operation, base, intended, options) {
  options = options || {}
  var draft = clone(operation.draft || {})
  operation.state = "superseded"
  operation.projection = null
  operation.draft = null
  var operationId = nextOperationId(state)
  var sequence = operationId.slice("operation-".length)
  var kind = options.kind || operation.kind
  var scope = operation.scope
  if (Object.prototype.hasOwnProperty.call(options, "scope")) {
    scope = options.scope
    if (!scope) scope = "provisional:" + operationId + ":"
      + (kind === "start" ? "active-timer-create" : "time-entry-create")
  }
  var baseToken = base && base.token || null
  var replacement = {
    operationId: operationId,
    kind: kind,
    scope: scope,
    contractVersion: operation.contractVersion,
    base: clone(base),
    baseToken: baseToken,
    expectedToken: operation.baseToken,
    patch: options.patch || patchForGroups(intended, changedGroups(base, intended)),
    intended: clone(intended),
    projection: clone(intended),
    draft: draft,
    state: "prepared",
    causalTag: "cause-" + sequence,
    request: {
      requestId: "request-" + sequence,
      commandClass: options.commandClass || operation.request.commandClass,
      argv: options.argv || guardedArgv(operation.request.argv, baseToken)
    },
    receipt: null,
    lineage: operation.operationId
  }
  state.operations.push(replacement)
  publishRecord(state, scope, intended)
  if (scope !== operation.scope) delete state.records[operation.scope]
  state.revision += 1
  return result(state, [{
    type: "persist",
    transactionId: operationId,
    snapshot: durableSnapshot(state)
  }])
}

function conflictOperation(state, operation, current, intended, groups) {
  operation.state = "conflicted"
  operation.expectedToken = operation.baseToken
  operation.base = clone(current)
  operation.baseToken = current && current.token || null
  operation.intended = clone(intended)
  operation.projection = clone(intended)
  operation.patch = patchForGroups(intended, groups)
  operation.request.argv = guardedArgv(operation.request.argv, operation.baseToken)
  publishRecord(state, operation.scope, intended)
  state.revision += 1
  return result(state, [{
    type: "persist",
    transactionId: "conflict-" + operation.operationId,
    snapshot: durableSnapshot(state)
  }])
}

function guardRejection(state, event) {
  var source = operationById(state, event.operationId)
  var details = event.error && event.error.details
  if (!source || source.state !== "in-flight" || !details || !isObject(details.current)) return result(state, [])
  var next = cloneState(state)
  var operation = operationById(next, event.operationId)
  var current = clone(details.current)
  var merge = mergeThreeWay(operation.base, operation.intended, current)
  if (merge.deletion) return conflictOperation(next, operation, current, operation.intended, [])
  var groups = merge.conflicts.slice()
  if (groups.length === 0 && operation.lineage !== null
      && changedGroups(current, merge.merged).length !== 0)
    groups = changedGroups(current, merge.merged)
  if (groups.length !== 0) return conflictOperation(next, operation, current, merge.merged, groups)
  if (changedGroups(current, merge.merged).length === 0)
    return closeWithoutMutation(next, operation, current)
  return replacementOperation(next, operation, current, merge.merged)
}

function resolutionOperation(state, intent) {
  var source = intent.operationId ? operationById(state, intent.operationId)
    : activeOperationForScope(state, intent.scope)
  if (!source || source.state !== "conflicted") return result(state, [])
  var next = cloneState(state)
  var operation = operationById(next, source.operationId)
  if (intent.type === "discard-local") return closeWithoutMutation(next, operation, operation.base)
  if (intent.type === "restore-as-new") {
    if (!operation.base || operation.base.exists !== false || !operation.intended
        || operation.intended.exists === false) return result(state, [])
    var restored = clone(operation.intended)
    restored.id = "provisional"
    var timer = restored.kind === "active-timer"
    if (timer) {
      for (var i = 0; i < restored.segments.length; i++) {
        restored.segments[i].id = "provisional-segment-" + (i + 1)
        restored.segments[i].timerId = "provisional"
      }
    }
    var argv = timer
      ? ["timer", "start", "--project", restored.projectId || "", "--service", restored.serviceId || "", "--note", restored.note]
      : ["time", "add", "--date", restored.localDate, "--duration", String(restored.durationSeconds),
        "--project", restored.projectId || "", "--service", restored.serviceId || "", "--note", restored.note]
    return replacementOperation(next, operation, null, restored, {
      scope: null,
      kind: timer ? "start" : "save-entry",
      commandClass: "single-write",
      argv: argv,
      patch: patchForGroups(restored, changedGroups(null, restored))
    })
  }
  if ((intent.type !== "choose-mine" && intent.type !== "choose-freshbooks")
      || EDITABLE_GROUPS.indexOf(intent.group) === -1
      || !Object.prototype.hasOwnProperty.call(operation.patch, intent.group))
    return result(state, [])
  if (intent.type === "choose-freshbooks") {
    operation.intended = copyGroup(operation.intended, operation.base, intent.group)
    operation.projection = copyGroup(operation.projection, operation.base, intent.group)
  }
  delete operation.patch[intent.group]
  publishRecord(next, operation.scope, operation.projection)
  if (Object.keys(operation.patch).length !== 0) {
    next.revision += 1
    return result(next, [{
      type: "persist",
      transactionId: "conflict-" + operation.operationId,
      snapshot: durableSnapshot(next)
    }])
  }
  if (intent.type === "choose-freshbooks"
      && changedGroups(operation.base, operation.intended).length === 0)
    return closeWithoutMutation(next, operation, operation.base)
  return replacementOperation(next, operation, operation.base, operation.intended)
}

function operationByTransaction(state, transactionId) {
  for (var i = state.operations.length - 1; i >= 0; i--) {
    var operation = state.operations[i]
    if (operation.operationId === transactionId
        || "started-" + operation.operationId === transactionId
        || "settlement-" + operation.operationId === transactionId
        || "conflict-" + operation.operationId === transactionId
        || "resolution-" + operation.operationId === transactionId) return operation
  }
  return null
}

function persisted(state, event) {
  var operation = operationByTransaction(state, event.transactionId)
  if (!operation) return result(state, [])
  if (event.transactionId === operation.operationId && operation.state === "prepared")
    return result(state, [requestFor(operation)])
  if (event.transactionId === "resolution-" + operation.operationId
      && operation.pendingResolution !== undefined) {
    var resolved = cloneState(state)
    var resolvedOperation = operationById(resolved, operation.operationId)
    var current = resolvedOperation.pendingResolution
    resolvedOperation.state = "settled"
    resolvedOperation.base = clone(current)
    resolvedOperation.baseToken = current && current.token || null
    resolvedOperation.intended = clone(current)
    resolvedOperation.projection = null
    resolvedOperation.draft = null
    resolvedOperation.patch = {}
    delete resolvedOperation.pendingResolution
    publishRecord(resolved, resolvedOperation.scope, current)
    resolved.revision += 1
    return result(resolved, [{ type: "compact", operationId: resolvedOperation.operationId }])
  }
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
  if (event.transactionId === "resolution-" + operation.operationId) {
    var unresolved = operationById(next, operation.operationId)
    delete unresolved.pendingResolution
  }
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
  if (event.type === "intent") {
    if (event.intent && (event.intent.type === "choose-mine"
        || event.intent.type === "choose-freshbooks"
        || event.intent.type === "restore-as-new"
        || event.intent.type === "discard-local")) return resolutionOperation(state, event.intent)
    return prepareIntent(state, event.intent)
  }
  if (event.type === "persisted") return persisted(state, event)
  if (event.type === "request-started") return requestStarted(state, event)
  if (event.type === "completion" && event.outcome === "receipt") return settleReceipt(state, event)
  if (event.type === "completion" && event.outcome === "known-error"
      && event.error && event.error.code === "GUARD_REJECTED") return guardRejection(state, event)
  if (event.type === "persistence-failed") return persistenceFailed(state, event)
  return result(state, [])
}

if (typeof module !== "undefined") module.exports = {
  initialState: initialState,
  restore: restore,
  apply: apply,
  changedGroups: changedGroups,
  mergeThreeWay: mergeThreeWay
}
