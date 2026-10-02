var SCHEMA_VERSION = 1
var TOKEN_PATTERN = /^[a-f0-9]{64}$/
var OPERATION_STATES = [
  "prepared", "in-flight", "settled", "rebasing", "conflicted",
  "unknown", "not-applied", "superseded"
]
var LOCKING_STATES = ["prepared", "in-flight", "rebasing", "conflicted", "unknown"]
var OPERATION_KEYS = [
  "operationId", "kind", "contractVersion", "scope", "state", "base",
  "baseToken", "expectedToken", "patch", "intended", "projection", "draft",
  "causalTag", "request", "receipt", "lineage", "creationBaseline", "knownError"
]
var REQUIRED_OPERATION_KEYS = [
  "operationId", "kind", "contractVersion", "scope", "state", "base",
  "baseToken", "patch", "intended", "projection", "draft", "causalTag",
  "request", "receipt", "lineage"
]
var DRAFT_KEYS = [
  "note", "duration", "localDate", "startedAt", "durationSeconds", "projectId",
  "serviceId", "clientId", "billable", "billed", "state", "timerId", "entryId",
  "token", "baseToken", "expectedToken"
]
var PATCH_KEYS = ["note", "duration", "date", "assignment", "timer-state"]
var RECEIPT_KINDS = [
  "time-entry-create", "time-entry-update", "time-entry-delete",
  "timer-start", "timer-pause", "timer-resume", "timer-correct",
  "timer-update", "timer-log", "timer-discard", "timer-switch"
]

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isString(value) { return typeof value === "string" }
function isBoolean(value) { return typeof value === "boolean" }
function isId(value) { return isString(value) && value.length > 0 }
function isNullableId(value) { return value === null || isId(value) }
function isInteger(value) { return typeof value === "number" && isFinite(value) && value >= 0 && Math.floor(value) === value }
function isToken(value) { return isString(value) && TOKEN_PATTERN.test(value) }
function isNullableToken(value) { return value === null || isToken(value) }
function isDate(value) {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  var parsed = new Date(value + "T00:00:00.000Z")
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function isInstant(value) {
  if (!isString(value)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  var parsed = new Date(value)
  return !isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function hasOnly(value, required) {
  if (!isObject(value)) return false
  var keys = Object.keys(value)
  if (keys.length !== required.length) return false
  for (var i = 0; i < required.length; i++)
    if (!Object.prototype.hasOwnProperty.call(value, required[i])) return false
  return true
}

function copyKeys(value, allowed) {
  var result = {}
  if (!isObject(value)) return result
  for (var i = 0; i < allowed.length; i++) {
    var key = allowed[i]
    if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = value[key]
  }
  return result
}

function hasRequiredAndOptional(value, required, optional) {
  if (!isObject(value)) return false
  var keys = Object.keys(value)
  for (var i = 0; i < required.length; i++)
    if (!Object.prototype.hasOwnProperty.call(value, required[i])) return false
  for (var j = 0; j < keys.length; j++)
    if (required.indexOf(keys[j]) === -1 && optional.indexOf(keys[j]) === -1) return false
  return true
}

function sanitizeRecord(record) {
  if (!isObject(record)) return record === null ? null : {}
  var keys
  if (record.exists === false) keys = ["contractVersion", "kind", "id", "exists", "token"]
  else if (record.kind === "time-entry") keys = [
    "contractVersion", "kind", "id", "exists", "localDate", "startedAt",
    "durationSeconds", "projectId", "clientId", "serviceId", "note",
    "billable", "billed", "token"
  ]
  else if (record.kind === "timer-segment") keys = [
    "contractVersion", "kind", "id", "timerId", "exists", "startedAt",
    "durationSeconds", "running", "logged", "token"
  ]
  else if (record.kind === "active-timer") keys = [
    "contractVersion", "kind", "id", "exists", "segments", "state",
    "elapsedAnchor", "projectId", "clientId", "serviceId", "note",
    "billable", "token"
  ]
  else return {}
  var result = copyKeys(record, keys)
  if (Array.isArray(result.segments)) {
    var segments = new Array(result.segments.length)
    for (var i = 0; i < result.segments.length; i++) segments[i] = sanitizeRecord(result.segments[i])
    result.segments = segments
  }
  if (isObject(result.elapsedAnchor))
    result.elapsedAnchor = copyKeys(result.elapsedAnchor, ["closedSeconds", "runningStartedAt", "observedAt"])
  return result
}

function validRecord(record) {
  if (!isObject(record) || record.contractVersion !== 2 || !isId(record.id)
      || !isString(record.kind) || !isBoolean(record.exists)) return false
  if (record.exists === false)
    return hasOnly(record, ["contractVersion", "kind", "id", "exists", "token"])
      && (record.kind === "time-entry" || record.kind === "active-timer") && record.token === null
  if (record.kind === "time-entry")
    return hasOnly(record, [
      "contractVersion", "kind", "id", "exists", "localDate", "startedAt",
      "durationSeconds", "projectId", "clientId", "serviceId", "note",
      "billable", "billed", "token"
    ]) && isDate(record.localDate) && isInstant(record.startedAt)
      && isInteger(record.durationSeconds) && isNullableId(record.projectId)
      && isNullableId(record.clientId) && isNullableId(record.serviceId)
      && isString(record.note) && isBoolean(record.billable) && isBoolean(record.billed)
      && isToken(record.token)
  if (record.kind === "timer-segment")
    return hasOnly(record, [
      "contractVersion", "kind", "id", "timerId", "exists", "startedAt",
      "durationSeconds", "running", "logged", "token"
    ]) && isId(record.timerId) && isInstant(record.startedAt)
      && (record.durationSeconds === null || isInteger(record.durationSeconds))
      && isBoolean(record.running) && isBoolean(record.logged) && isToken(record.token)
      && (record.running === (record.durationSeconds === null && !record.logged))
  if (record.kind !== "active-timer" || !hasOnly(record, [
    "contractVersion", "kind", "id", "exists", "segments", "state",
    "elapsedAnchor", "projectId", "clientId", "serviceId", "note",
    "billable", "token"
  ]) || !Array.isArray(record.segments) || record.segments.length === 0
      || (record.state !== "running" && record.state !== "paused")
      || !hasOnly(record.elapsedAnchor, ["closedSeconds", "runningStartedAt", "observedAt"])
      || !isInteger(record.elapsedAnchor.closedSeconds)
      || !(record.elapsedAnchor.runningStartedAt === null || isInstant(record.elapsedAnchor.runningStartedAt))
      || !isInstant(record.elapsedAnchor.observedAt) || !isNullableId(record.projectId)
      || !isNullableId(record.clientId) || !isNullableId(record.serviceId)
      || !isString(record.note) || !isBoolean(record.billable) || !isToken(record.token)) return false
  var running = 0
  for (var i = 0; i < record.segments.length; i++) {
    if (!validRecord(record.segments[i]) || record.segments[i].kind !== "timer-segment"
        || record.segments[i].timerId !== record.id) return false
    if (record.segments[i].running) running += 1
  }
  return running <= 1
    && (record.state === "running") === (running === 1)
    && (record.state === "running") === (record.elapsedAnchor.runningStartedAt !== null)
}

function sanitizeSemanticObject(value, allowed) {
  var result = copyKeys(value, allowed)
  var keys = Object.keys(result)
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    if (isObject(result[key])) result[key] = sanitizeSemanticObject(result[key], DRAFT_KEYS)
    else if (Array.isArray(result[key])) result[key] = result[key].slice()
  }
  return result
}

function sanitizePatch(value) {
  var result = copyKeys(value, PATCH_KEYS)
  if (isObject(result.date)) result.date = copyKeys(result.date, ["localDate", "startedAt"])
  if (isObject(result.assignment))
    result.assignment = copyKeys(result.assignment, ["projectId", "serviceId", "clientId", "billable"])
  if (isObject(result["timer-state"]))
    result["timer-state"] = copyKeys(result["timer-state"], ["state", "durationSeconds", "startedAt"])
  return result
}

function sanitizeRequest(value) {
  var result = copyKeys(value, ["requestId", "commandClass", "argv"])
  if (Array.isArray(result.argv)) result.argv = result.argv.slice()
  return result
}

function sanitizeKnownError(value) {
  return isObject(value) ? copyKeys(value, ["code", "message"]) : value
}

function sanitizeReceipt(receipt) {
  if (!isObject(receipt)) return receipt === null ? null : {}
  var result = copyKeys(receipt, ["contractVersion", "mutationKind", "changes", "results", "phase"])
  if (Array.isArray(result.changes)) {
    var changes = new Array(result.changes.length)
    for (var i = 0; i < result.changes.length; i++) {
      var change = copyKeys(result.changes[i], ["scope", "before", "after"])
      change.before = copyKeys(change.before, ["token", "absent"])
      change.after = copyKeys(change.after, ["record", "deleted"])
      if (change.after.record !== undefined) change.after.record = sanitizeRecord(change.after.record)
      changes[i] = change
    }
    result.changes = changes
  }
  if (Array.isArray(result.results)) {
    var records = new Array(result.results.length)
    for (var j = 0; j < result.results.length; j++) records[j] = sanitizeRecord(result.results[j])
    result.results = records
  }
  if (isObject(result.phase)) result.phase = copyKeys(result.phase, ["log", "start"])
  return result
}

function sanitizeCreationBaseline(value) {
  if (!isObject(value)) return {}
  var result = copyKeys(value, ["queryKey", "coverage", "identities"])
  result.coverage = copyKeys(result.coverage, [
    "kind", "identity", "from", "to", "complete", "includesDeleted"
  ])
  if (Array.isArray(result.identities)) result.identities = result.identities.slice()
  return result
}

function sanitizeOperation(operation) {
  var result = copyKeys(operation, OPERATION_KEYS)
  result.base = sanitizeRecord(result.base)
  result.patch = sanitizePatch(result.patch)
  result.intended = sanitizeRecord(result.intended)
  result.projection = sanitizeRecord(result.projection)
  result.draft = result.draft === null ? null : sanitizeSemanticObject(result.draft, DRAFT_KEYS)
  result.request = sanitizeRequest(result.request)
  result.receipt = sanitizeReceipt(result.receipt)
  if (result.knownError !== undefined) result.knownError = sanitizeKnownError(result.knownError)
  if (result.creationBaseline !== undefined)
    result.creationBaseline = sanitizeCreationBaseline(result.creationBaseline)
  return result
}

function persistable(snapshot) {
  var operations = []
  var sourceOperations = Array.isArray(snapshot && snapshot.operations) ? snapshot.operations : []
  for (var i = 0; i < sourceOperations.length; i++) operations.push(sanitizeOperation(sourceOperations[i]))
  var records = {}
  var sourceRecords = isObject(snapshot && snapshot.records) ? snapshot.records : {}
  var scopes = Object.keys(sourceRecords)
  for (var j = 0; j < scopes.length; j++) records[scopes[j]] = sanitizeRecord(sourceRecords[scopes[j]])
  return { schemaVersion: SCHEMA_VERSION, operations: operations, records: records }
}

function validRequest(request) {
  if (!hasOnly(request, ["requestId", "commandClass", "argv"]) || !isId(request.requestId)
      || ["read", "single-write", "multi-segment", "log", "switch"].indexOf(request.commandClass) === -1
      || !Array.isArray(request.argv)) return false
  for (var i = 0; i < request.argv.length; i++) if (!isString(request.argv[i])) return false
  return true
}

function validPatch(patch) {
  if (!isObject(patch)) return false
  var keys = Object.keys(patch)
  for (var i = 0; i < keys.length; i++) if (PATCH_KEYS.indexOf(keys[i]) === -1) return false
  if (patch.note !== undefined && !isString(patch.note)) return false
  if (patch.duration !== undefined) {
    var duration = patch.duration
    if (!(isString(duration) || isInteger(duration)
        || hasOnly(duration, ["durationSeconds"]) && isInteger(duration.durationSeconds))) return false
  }
  if (patch.date !== undefined) {
    if (!isObject(patch.date) || Object.keys(patch.date).length === 0
        || !hasRequiredAndOptional(patch.date, [], ["localDate", "startedAt"])
        || patch.date.localDate !== undefined && !isString(patch.date.localDate)
        || patch.date.startedAt !== undefined && !isString(patch.date.startedAt)) return false
  }
  if (patch.assignment !== undefined) {
    var assignment = patch.assignment
    if (!isObject(assignment) || Object.keys(assignment).length === 0
        || !hasRequiredAndOptional(assignment, [], ["projectId", "serviceId", "clientId", "billable"])
        || assignment.projectId !== undefined && !isNullableId(assignment.projectId)
        || assignment.serviceId !== undefined && !isNullableId(assignment.serviceId)
        || assignment.clientId !== undefined && !isNullableId(assignment.clientId)
        || assignment.billable !== undefined && !isBoolean(assignment.billable)) return false
  }
  if (patch["timer-state"] !== undefined) {
    var timerState = patch["timer-state"]
    if (!isObject(timerState) || Object.keys(timerState).length === 0
        || !hasRequiredAndOptional(timerState, [], ["state", "durationSeconds", "startedAt"])
        || timerState.state !== undefined && !isString(timerState.state)
        || timerState.durationSeconds !== undefined && !isInteger(timerState.durationSeconds)
        || timerState.startedAt !== undefined && !isString(timerState.startedAt)) return false
  }
  return true
}

function validDraft(draft) {
  if (!isObject(draft)) return false
  var keys = Object.keys(draft)
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    var value = draft[key]
    if (DRAFT_KEYS.indexOf(key) === -1) return false
    if ((key === "note" || key === "duration" || key === "localDate" || key === "startedAt"
        || key === "state" || key === "timerId" || key === "entryId") && !isString(value)) return false
    if (key === "durationSeconds" && !isInteger(value)) return false
    if ((key === "projectId" || key === "serviceId" || key === "clientId") && !isNullableId(value)) return false
    if ((key === "billable" || key === "billed") && !isBoolean(value)) return false
    if ((key === "token" || key === "baseToken" || key === "expectedToken") && !isNullableToken(value)) return false
  }
  return true
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

function validReceiptScope(scope) {
  return isString(scope) && (/^(time-entry|active-timer):[^:]+$/.test(scope)
    || /^provisional:operation-\d+:(time-entry-create|active-timer-create|timer-switch-target)$/.test(scope))
}

function receiptCoversOperation(operation, receipt) {
  for (var i = 0; i < receipt.changes.length; i++)
    if (receipt.changes[i].scope === operation.scope) return true
  if (operation.kind === "switch" && receipt.mutationKind === "timer-switch"
      && receipt.phase && receipt.phase.log === "confirmed"
      && receipt.phase.start === "failed") return true
  if (operation.scope.indexOf("provisional:") !== 0) return false
  var expected = operation.scope.split(":")[2]
  var prefix = ""
  if (expected === "time-entry-create" && receipt.mutationKind === "time-entry-create") prefix = "time-entry:"
  else if (expected === "active-timer-create" && receipt.mutationKind === "timer-start") prefix = "active-timer:"
  else if (expected === "timer-switch-target" && receipt.mutationKind === "timer-switch") prefix = "active-timer:"
  if (prefix === "") return false
  for (var j = 0; j < receipt.changes.length; j++)
    if (receipt.changes[j].scope.indexOf(prefix) === 0
        && receipt.changes[j].before.absent === true) return true
  return false
}

function validReceipt(receipt, operation) {
  if (!hasOnly(receipt, ["contractVersion", "mutationKind", "changes", "results", "phase"])
      || receipt.contractVersion !== 2 || RECEIPT_KINDS.indexOf(receipt.mutationKind) === -1
      || !Array.isArray(receipt.changes) || receipt.changes.length === 0
      || !Array.isArray(receipt.results)) return false
  if (receipt.mutationKind === "timer-switch") {
    if (!hasOnly(receipt.phase, ["log", "start"]) || receipt.phase.log !== "confirmed"
        || ["confirmed", "failed"].indexOf(receipt.phase.start) === -1) return false
  } else if (receipt.phase !== null) return false
  var expectedResults = []
  var seenScopes = {}
  for (var i = 0; i < receipt.changes.length; i++) {
    var change = receipt.changes[i]
    if (!hasOnly(change, ["scope", "before", "after"]) || !validReceiptScope(change.scope)
        || seenScopes[change.scope]) return false
    seenScopes[change.scope] = true
    var beforeToken = hasOnly(change.before, ["token"]) && isToken(change.before.token)
    var beforeAbsent = hasOnly(change.before, ["absent"]) && change.before.absent === true
    if (!beforeToken && !beforeAbsent) return false
    if (hasOnly(change.after, ["record"]) && validRecord(change.after.record)) {
      if (change.after.record.kind === "timer-segment"
          || change.scope !== change.after.record.kind + ":" + change.after.record.id) return false
      expectedResults.push(change.after.record)
    } else if (hasOnly(change.after, ["deleted"]) && change.after.deleted === true) {
      var parts = change.scope.split(":")
      if (parts[0] === "provisional") return false
      expectedResults.push({
        contractVersion: 2,
        kind: parts[0],
        id: parts.slice(1).join(":"),
        exists: false,
        token: null
      })
    } else return false
  }
  if (receipt.results.length !== expectedResults.length) return false
  var unmatched = receipt.results.slice()
  for (var j = 0; j < expectedResults.length; j++) {
    var found = -1
    for (var k = 0; k < unmatched.length; k++)
      if (sameValue(expectedResults[j], unmatched[k])) { found = k; break }
    if (found === -1 || !validRecord(unmatched[found])
        || unmatched[found].kind === "timer-segment") return false
    unmatched.splice(found, 1)
  }
  if (operation.kind === "switch" && receipt.mutationKind === "timer-switch"
      && receipt.phase.start === "failed") {
    if (receipt.changes.length !== 2) return false
    var hasLoggedEntry = false
    var hasStoppedTimer = false
    for (var m = 0; m < receipt.changes.length; m++) {
      var partialChange = receipt.changes[m]
      if (hasOnly(partialChange.after, ["record"])
          && partialChange.after.record.kind === "time-entry"
          && partialChange.after.record.exists === true) hasLoggedEntry = true
      else if (hasOnly(partialChange.after, ["deleted"])
          && partialChange.after.deleted === true
          && partialChange.scope.indexOf("active-timer:") === 0) hasStoppedTimer = true
      else return false
    }
    if (!hasLoggedEntry || !hasStoppedTimer) return false
  }
  return receiptCoversOperation(operation, receipt)
}

function validScope(scope, operationId) {
  if (!isString(scope)) return false
  if (/^(time-entry|active-timer):[^:]+$/.test(scope)) return true
  var match = /^provisional:(operation-\d+):(time-entry-create|active-timer-create|timer-switch-target)$/.exec(scope)
  return match !== null && match[1] === operationId
}

function validCreationBaseline(value, operation) {
  if (!hasOnly(value, ["queryKey", "coverage", "identities"]) || !isId(value.queryKey)
      || !hasOnly(value.coverage, [
        "kind", "identity", "from", "to", "complete", "includesDeleted"
      ]) || (value.coverage.kind !== "time-entry" && value.coverage.kind !== "active-timer")
      || value.coverage.identity !== null
      || !(value.coverage.from === null || isDate(value.coverage.from))
      || !(value.coverage.to === null || isDate(value.coverage.to))
      || value.coverage.complete !== true || value.coverage.includesDeleted !== true
      || !Array.isArray(value.identities)) return false
  var scope = /^provisional:operation-\d+:(time-entry-create|active-timer-create|timer-switch-target)$/.exec(operation.scope)
  if (!scope || !operation.intended || operation.intended.exists === false) return false
  var creationClass = scope[1]
  var expectedKind = creationClass === "time-entry-create" ? "time-entry" : "active-timer"
  var expectedOperationKind = creationClass === "time-entry-create" ? "save-entry"
    : creationClass === "active-timer-create" ? "start" : "switch"
  if (operation.kind !== expectedOperationKind || operation.intended.kind !== expectedKind
      || creationClass !== "timer-switch-target" && operation.base !== null
      || value.coverage.kind !== expectedKind) return false
  if (expectedKind === "time-entry") {
    var date = operation.intended.localDate
    if (value.queryKey !== "time-entries:" + date
        || value.coverage.from !== date || value.coverage.to !== date) return false
  } else if (value.queryKey !== "active-timer"
      || value.coverage.from !== null || value.coverage.to !== null) return false
  var seen = {}
  var identityPrefix = expectedKind + ":"
  for (var i = 0; i < value.identities.length; i++) {
    var identity = value.identities[i]
    if (!isString(identity) || identity.indexOf(identityPrefix) !== 0
        || !isId(identity.slice(identityPrefix.length))
        || identity === identityPrefix + "provisional" || seen[identity]) return false
    seen[identity] = true
  }
  return true
}

function validOperation(operation) {
  if (!isObject(operation)
      || !hasRequiredAndOptional(operation, REQUIRED_OPERATION_KEYS, [
        "expectedToken", "creationBaseline", "knownError"
      ])
      || !/^operation-\d+$/.test(operation.operationId) || !isId(operation.kind)
      || operation.contractVersion !== 2 || !validScope(operation.scope, operation.operationId)
      || OPERATION_STATES.indexOf(operation.state) === -1
      || !(operation.base === null || validRecord(operation.base))
      || !isNullableToken(operation.baseToken)
      || !(operation.expectedToken === undefined || isNullableToken(operation.expectedToken))
      || !validPatch(operation.patch) || !(operation.intended === null || validRecord(operation.intended))
      || !validRequest(operation.request) || !isId(operation.causalTag)
      || !(operation.lineage === null || isId(operation.lineage))) return false
  if (operation.scope.indexOf("provisional:") === 0
      && operation.creationBaseline === undefined) return false
  if (operation.creationBaseline !== undefined
      && !validCreationBaseline(operation.creationBaseline, operation)) return false
  if (operation.knownError !== undefined
      && (!hasOnly(operation.knownError, ["code", "message"])
        || !isId(operation.knownError.code) || !isString(operation.knownError.message))) return false
  if (operation.state === "settled")
    return operation.draft === null && operation.projection === null
      && validReceipt(operation.receipt, operation)
  if (operation.state === "unknown" && operation.kind === "switch"
      && operation.receipt && operation.receipt.phase
      && operation.receipt.phase.start === "failed")
    return validDraft(operation.draft) && validRecord(operation.projection)
      && validReceipt(operation.receipt, operation)
  if (operation.state === "not-applied" && operation.knownError)
    return validDraft(operation.draft) && operation.projection === null
      && operation.receipt === null
  if (operation.state === "superseded")
    return operation.draft === null && operation.projection === null
  return validDraft(operation.draft) && validRecord(operation.projection) && operation.receipt === null
}

function validSnapshot(snapshot) {
  if (!Array.isArray(snapshot.operations) || !isObject(snapshot.records)) return false
  var ids = {}
  var locks = {}
  var provisionalScopes = {}
  for (var i = 0; i < snapshot.operations.length; i++) {
    var operation = snapshot.operations[i]
    if (!validOperation(operation) || ids[operation.operationId]) return false
    ids[operation.operationId] = true
    if (operation.scope.indexOf("provisional:") === 0) provisionalScopes[operation.scope] = true
    if (LOCKING_STATES.indexOf(operation.state) !== -1) {
      if (locks[operation.scope]) return false
      locks[operation.scope] = true
    }
  }
  var scopes = Object.keys(snapshot.records)
  for (var j = 0; j < scopes.length; j++) {
    var record = snapshot.records[scopes[j]]
    if (!validRecord(record)) return false
    if (scopes[j] !== record.kind + ":" + record.id && !provisionalScopes[scopes[j]]) return false
  }
  return true
}

function serialize(snapshot) {
  var durable = persistable(snapshot)
  if (!validSnapshot(durable)) throw new Error("invalid durable ledger snapshot")
  return JSON.stringify(durable)
}

function recovery(code, message, unreadText) {
  return {
    snapshot: null,
    recoveryError: { code: code, message: message, persistent: true },
    unreadText: unreadText,
    effects: []
  }
}

function deserialize(text) {
  var unreadText = String(text === undefined || text === null ? "" : text)
  var parsed
  try {
    parsed = JSON.parse(unreadText)
  } catch (error) {
    return recovery("LEDGER_CORRUPT", "The operation ledger is not valid JSON.", unreadText)
  }
  if (!isObject(parsed) || parsed.schemaVersion !== SCHEMA_VERSION)
    return recovery("LEDGER_SCHEMA_UNSUPPORTED", "The operation ledger schema is unsupported.", unreadText)
  var keys = Object.keys(parsed).sort()
  if (keys.length !== 3 || keys[0] !== "operations" || keys[1] !== "records"
      || keys[2] !== "schemaVersion" || !validSnapshot(parsed))
    return recovery("LEDGER_CORRUPT", "The operation ledger structure is invalid.", unreadText)
  return { snapshot: persistable(parsed), recoveryError: null, unreadText: "", effects: [] }
}

if (typeof module !== "undefined") module.exports = {
  serialize: serialize,
  deserialize: deserialize
}
