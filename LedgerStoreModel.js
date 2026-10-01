var SCHEMA_VERSION = 1
var SEMANTIC_TOKEN_KEYS = ["token", "baseToken", "expectedToken", "currentToken"]
var TOKEN_PATTERN = /^[a-f0-9]{64}$/
var OPERATION_STATES = [
  "prepared", "in-flight", "settled", "rebasing", "conflicted",
  "unknown", "not-applied", "superseded"
]

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isSemanticToken(key, value) {
  if (SEMANTIC_TOKEN_KEYS.indexOf(key) === -1) return false
  return value === null || typeof value === "string" && TOKEN_PATTERN.test(value)
}

function forbiddenKey(key, value) {
  if (/authorization|header|rawResponse/i.test(key)) return true
  return /token/i.test(key) && !isSemanticToken(key, value)
}

function sanitized(value) {
  if (Array.isArray(value)) {
    var array = new Array(value.length)
    for (var i = 0; i < value.length; i++) array[i] = sanitized(value[i])
    return array
  }
  if (!isObject(value)) return value
  var result = {}
  var keys = Object.keys(value)
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j]
    if (!forbiddenKey(key, value[key])) result[key] = sanitized(value[key])
  }
  return result
}

function persistable(snapshot) {
  return {
    schemaVersion: SCHEMA_VERSION,
    operations: sanitized(Array.isArray(snapshot && snapshot.operations) ? snapshot.operations : []),
    records: sanitized(isObject(snapshot && snapshot.records) ? snapshot.records : {})
  }
}

function validSnapshot(snapshot) {
  if (!Array.isArray(snapshot.operations) || !isObject(snapshot.records)) return false
  for (var i = 0; i < snapshot.operations.length; i++) {
    var operation = snapshot.operations[i]
    if (!isObject(operation) || !/^operation-\d+$/.test(operation.operationId)
        || typeof operation.kind !== "string" || operation.kind.length === 0
        || typeof operation.scope !== "string" || operation.scope.length === 0
        || operation.contractVersion !== 2
        || OPERATION_STATES.indexOf(operation.state) === -1) return false
  }
  var scopes = Object.keys(snapshot.records)
  for (var j = 0; j < scopes.length; j++)
    if (!isObject(snapshot.records[scopes[j]])) return false
  return true
}

function serialize(snapshot) {
  return JSON.stringify(persistable(snapshot))
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
  return {
    snapshot: persistable(parsed),
    recoveryError: null,
    unreadText: "",
    effects: []
  }
}

if (typeof module !== "undefined") module.exports = {
  serialize: serialize,
  deserialize: deserialize
}
