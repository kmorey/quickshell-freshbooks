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
  "causalTag", "request", "receipt", "lineage"
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
    ]) && isString(record.localDate) && isString(record.startedAt)
      && isInteger(record.durationSeconds) && isNullableId(record.projectId)
      && isNullableId(record.clientId) && isNullableId(record.serviceId)
      && isString(record.note) && isBoolean(record.billable) && isBoolean(record.billed)
      && isToken(record.token)
  if (record.kind === "timer-segment")
    return hasOnly(record, [
      "contractVersion", "kind", "id", "timerId", "exists", "startedAt",
      "durationSeconds", "running", "logged", "token"
    ]) && isId(record.timerId) && isString(record.startedAt)
      && (record.durationSeconds === null || isInteger(record.durationSeconds))
      && isBoolean(record.running) && isBoolean(record.logged) && isToken(record.token)
  if (record.kind !== "active-timer" || !hasOnly(record, [
    "contractVersion", "kind", "id", "exists", "segments", "state",
    "elapsedAnchor", "projectId", "clientId", "serviceId", "note",
    "billable", "token"
  ]) || !Array.isArray(record.segments) || record.segments.length === 0
      || (record.state !== "running" && record.state !== "paused")
      || !hasOnly(record.elapsedAnchor, ["closedSeconds", "runningStartedAt", "observedAt"])
      || !isInteger(record.elapsedAnchor.closedSeconds)
      || !(record.elapsedAnchor.runningStartedAt === null || isString(record.elapsedAnchor.runningStartedAt))
      || !isString(record.elapsedAnchor.observedAt) || !isNullableId(record.projectId)
      || !isNullableId(record.clientId) || !isNullableId(record.serviceId)
      || !isString(record.note) || !isBoolean(record.billable) || !isToken(record.token)) return false
  for (var i = 0; i < record.segments.length; i++)
    if (!validRecord(record.segments[i]) || record.segments[i].kind !== "timer-segment"
        || record.segments[i].timerId !== record.id) return false
  return true
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

function sanitizeOperation(operation) {
  var result = copyKeys(operation, OPERATION_KEYS)
  result.base = sanitizeRecord(result.base)
  result.patch = sanitizePatch(result.patch)
  result.intended = sanitizeRecord(result.intended)
  result.projection = sanitizeRecord(result.projection)
  result.draft = result.draft === null ? null : sanitizeSemanticObject(result.draft, DRAFT_KEYS)
  result.request = sanitizeRequest(result.request)
  result.receipt = sanitizeReceipt(result.receipt)
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

function validReceipt(receipt) {
  if (!isObject(receipt) || receipt.contractVersion !== 2 || !isId(receipt.mutationKind)
      || !Array.isArray(receipt.changes) || !Array.isArray(receipt.results)
      || !(receipt.phase === null || isObject(receipt.phase))) return false
  for (var i = 0; i < receipt.results.length; i++) if (!validRecord(receipt.results[i])) return false
  return true
}

function validScope(scope, operationId) {
  if (!isString(scope)) return false
  if (/^(time-entry|active-timer):[^:]+$/.test(scope)) return true
  var match = /^provisional:(operation-\d+):(time-entry-create|active-timer-create|timer-switch-target)$/.exec(scope)
  return match !== null && match[1] === operationId
}

function validOperation(operation) {
  if (!isObject(operation)
      || !hasRequiredAndOptional(operation, REQUIRED_OPERATION_KEYS, ["expectedToken"])
      || !/^operation-\d+$/.test(operation.operationId) || !isId(operation.kind)
      || operation.contractVersion !== 2 || !validScope(operation.scope, operation.operationId)
      || OPERATION_STATES.indexOf(operation.state) === -1
      || !(operation.base === null || validRecord(operation.base))
      || !isNullableToken(operation.baseToken)
      || !(operation.expectedToken === undefined || isNullableToken(operation.expectedToken))
      || !isObject(operation.patch) || !(operation.intended === null || validRecord(operation.intended))
      || !validRequest(operation.request) || !isId(operation.causalTag)
      || !(operation.lineage === null || isId(operation.lineage))) return false
  if (operation.state === "settled")
    return operation.draft === null && operation.projection === null && validReceipt(operation.receipt)
  if (operation.state === "superseded")
    return operation.draft === null && operation.projection === null
  return isObject(operation.draft) && validRecord(operation.projection) && operation.receipt === null
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
