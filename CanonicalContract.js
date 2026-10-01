var CONTRACT_VERSION = 2
var ENVELOPE_SCHEMA_VERSION = 1
var MINIMUM_CLI_VERSION = [0, 3, 0]
var TOKEN_PATTERN = /^[a-f0-9]{64}$/
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
var RECEIPT_KINDS = [
  "time-entry-create", "time-entry-update", "time-entry-delete",
  "timer-start", "timer-pause", "timer-resume", "timer-correct",
  "timer-update", "timer-log", "timer-discard", "timer-switch"
]

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasOnly(value, required, optional) {
  if (!isObject(value)) return false
  var allowed = required.concat(optional || [])
  var keys = Object.keys(value)
  for (var i = 0; i < required.length; i++)
    if (!Object.prototype.hasOwnProperty.call(value, required[i])) return false
  for (var j = 0; j < keys.length; j++)
    if (allowed.indexOf(keys[j]) === -1) return false
  return true
}

function isString(value) { return typeof value === "string" }
function isId(value) { return isString(value) && value.length > 0 }
function isBoolean(value) { return typeof value === "boolean" }
function isFiniteNumber(value) { return typeof value === "number" && isFinite(value) }

function sameValue(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (var i = 0; i < left.length; i++)
      if (!sameValue(left[i], right[i])) return false
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
function isNonNegativeNumber(value) { return isFiniteNumber(value) && value >= 0 }
function isNullableId(value) { return value === null || isId(value) }
function isToken(value) { return isString(value) && TOKEN_PATTERN.test(value) }
function isDate(value) { return isString(value) && DATE_PATTERN.test(value) }
function isInstant(value) { return isString(value) && !isNaN(Date.parse(value)) }

function validateTimeEntry(record) {
  if (!hasOnly(record, [
    "contractVersion", "kind", "id", "exists", "localDate", "startedAt",
    "durationSeconds", "projectId", "clientId", "serviceId", "note",
    "billable", "billed", "token"
  ])) return false
  return record.contractVersion === CONTRACT_VERSION
    && record.kind === "time-entry" && record.exists === true && isId(record.id)
    && isDate(record.localDate) && isInstant(record.startedAt)
    && isNonNegativeNumber(record.durationSeconds)
    && isNullableId(record.projectId) && isNullableId(record.clientId)
    && isNullableId(record.serviceId) && isString(record.note)
    && isBoolean(record.billable) && isBoolean(record.billed) && isToken(record.token)
}

function validateTimerSegment(record) {
  if (!hasOnly(record, [
    "contractVersion", "kind", "id", "timerId", "exists", "startedAt",
    "durationSeconds", "running", "logged", "token"
  ])) return false
  return record.contractVersion === CONTRACT_VERSION
    && record.kind === "timer-segment" && record.exists === true
    && isId(record.id) && isId(record.timerId) && isInstant(record.startedAt)
    && (record.durationSeconds === null || isNonNegativeNumber(record.durationSeconds))
    && isBoolean(record.running) && isBoolean(record.logged) && isToken(record.token)
    && (record.running === (record.durationSeconds === null && !record.logged))
}

function validateElapsedAnchor(anchor) {
  return hasOnly(anchor, ["closedSeconds", "runningStartedAt", "observedAt"])
    && isNonNegativeNumber(anchor.closedSeconds)
    && (anchor.runningStartedAt === null || isInstant(anchor.runningStartedAt))
    && isInstant(anchor.observedAt)
}

function validateActiveTimer(record) {
  if (!hasOnly(record, [
    "contractVersion", "kind", "id", "exists", "segments", "state",
    "elapsedAnchor", "projectId", "clientId", "serviceId", "note",
    "billable", "token"
  ])) return false
  if (record.contractVersion !== CONTRACT_VERSION || record.kind !== "active-timer"
      || record.exists !== true || !isId(record.id) || !Array.isArray(record.segments)
      || record.segments.length === 0 || ["running", "paused"].indexOf(record.state) === -1
      || !validateElapsedAnchor(record.elapsedAnchor)
      || !isNullableId(record.projectId) || !isNullableId(record.clientId)
      || !isNullableId(record.serviceId) || !isString(record.note)
      || !isBoolean(record.billable) || !isToken(record.token)) return false
  var running = 0
  for (var i = 0; i < record.segments.length; i++) {
    if (!validateTimerSegment(record.segments[i]) || record.segments[i].timerId !== record.id) return false
    if (record.segments[i].running) running += 1
  }
  return running <= 1
    && (record.state === "running") === (running === 1)
    && (record.state === "running") === (record.elapsedAnchor.runningStartedAt !== null)
}

function validateDeleted(record) {
  return hasOnly(record, ["contractVersion", "kind", "id", "exists", "token"])
    && record.contractVersion === CONTRACT_VERSION
    && ["time-entry", "active-timer"].indexOf(record.kind) !== -1
    && isId(record.id) && record.exists === false && record.token === null
}

function validateCanonicalRecord(record) {
  if (!isObject(record)) return false
  if (record.exists === false) return validateDeleted(record)
  if (record.kind === "time-entry") return validateTimeEntry(record)
  if (record.kind === "timer-segment") return validateTimerSegment(record)
  if (record.kind === "active-timer") return validateActiveTimer(record)
  return false
}

function validateCoverage(coverage) {
  return hasOnly(coverage, ["complete", "includesDeleted", "fromDate", "toDate"])
    && isBoolean(coverage.complete) && isBoolean(coverage.includesDeleted)
    && (coverage.fromDate === null || isDate(coverage.fromDate))
    && (coverage.toDate === null || isDate(coverage.toDate))
}

function validateObservation(data) {
  if (!hasOnly(data, ["contractVersion", "queryKey", "coverage", "records"])) return false
  if (data.contractVersion !== CONTRACT_VERSION || !isString(data.queryKey)
      || data.queryKey.length === 0 || !validateCoverage(data.coverage)
      || !Array.isArray(data.records)) return false
  for (var i = 0; i < data.records.length; i++)
    if (!validateCanonicalRecord(data.records[i])) return false
  return true
}

function validateBefore(before) {
  if (!isObject(before)) return false
  return hasOnly(before, ["token"]) && isToken(before.token)
    || hasOnly(before, ["absent"]) && before.absent === true
}

function validateAfter(after) {
  if (!isObject(after)) return false
  return hasOnly(after, ["record"]) && validateCanonicalRecord(after.record)
    || hasOnly(after, ["deleted"]) && after.deleted === true
}

function validScope(scope) {
  return isString(scope) && (/^(time-entry|active-timer):[^:]+$/.test(scope)
    || /^provisional:[^:]+:(time-entry-create|active-timer-create|timer-switch-target)$/.test(scope))
}

function requestScopeCovered(request, data) {
  if (!request || !isString(request.scope) || request.scope.length === 0) return true
  for (var i = 0; i < data.changes.length; i++)
    if (data.changes[i].scope === request.scope) return true
  if (request.scope.indexOf("provisional:") !== 0) return false
  var expectedKind = request.scope.split(":")[2]
  var scopePrefix = expectedKind === "time-entry-create" ? "time-entry:"
    : expectedKind === "active-timer-create" || expectedKind === "timer-switch-target" ? "active-timer:"
    : ""
  if (scopePrefix === "") return false
  for (var j = 0; j < data.changes.length; j++)
    if (data.changes[j].scope.indexOf(scopePrefix) === 0
        && data.changes[j].before && data.changes[j].before.absent === true) return true
  return false
}

function validateReceipt(data, request) {
  if (!hasOnly(data, ["contractVersion", "mutationKind", "changes", "results", "phase"])) return false
  if (data.contractVersion !== CONTRACT_VERSION
      || RECEIPT_KINDS.indexOf(data.mutationKind) === -1
      || !Array.isArray(data.changes) || data.changes.length === 0
      || !Array.isArray(data.results)) return false
  if (data.mutationKind === "timer-switch") {
    if (!hasOnly(data.phase, ["log", "start"]) || data.phase.log !== "confirmed"
        || ["confirmed", "failed"].indexOf(data.phase.start) === -1) return false
  } else if (data.phase !== null) {
    return false
  }
  var expectedResults = []
  var seenScopes = {}
  for (var i = 0; i < data.changes.length; i++) {
    var change = data.changes[i]
    if (!hasOnly(change, ["scope", "before", "after"]) || !validScope(change.scope)
        || seenScopes[change.scope] === true
        || !validateBefore(change.before) || !validateAfter(change.after)) return false
    seenScopes[change.scope] = true
    if (change.after.record) {
      var expectedScope = change.after.record.kind + ":" + change.after.record.id
      if (change.after.record.kind === "timer-segment" || change.scope !== expectedScope) return false
      expectedResults.push(change.after.record)
    } else {
      var scopeParts = change.scope.split(":")
      if (scopeParts[0] === "provisional") return false
      expectedResults.push({
        contractVersion: CONTRACT_VERSION,
        kind: scopeParts[0],
        id: scopeParts.slice(1).join(":"),
        exists: false,
        token: null
      })
    }
  }
  if (data.results.length !== expectedResults.length) return false
  var unmatched = data.results.slice()
  for (var j = 0; j < expectedResults.length; j++) {
    var found = -1
    for (var k = 0; k < unmatched.length; k++)
      if (sameValue(expectedResults[j], unmatched[k])) { found = k; break }
    if (found === -1 || !validateCanonicalRecord(unmatched[found])
        || unmatched[found].kind === "timer-segment") return false
    unmatched.splice(found, 1)
  }
  return requestScopeCovered(request, data)
}

function validateGuardRejection(error) {
  if (!isObject(error) || error.code !== "GUARD_REJECTED" || !isString(error.message)) return false
  var details = error.details
  if (!hasOnly(details, ["contractVersion", "identity", "expectedToken", "currentToken", "current"])) return false
  if (!hasOnly(details.identity, ["kind", "id"])
      || ["time-entry", "active-timer"].indexOf(details.identity.kind) === -1
      || !isId(details.identity.id) || details.contractVersion !== CONTRACT_VERSION
      || !isToken(details.expectedToken)
      || !(details.currentToken === null || isToken(details.currentToken))
      || !validateCanonicalRecord(details.current)) return false
  return details.current.kind === details.identity.kind && details.current.id === details.identity.id
    && details.current.token === details.currentToken
}

function semverAtLeast(version, minimum) {
  if (!isString(version)) return false
  var match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (!match) return false
  var actual = [Number(match[1]), Number(match[2]), Number(match[3])]
  for (var i = 0; i < 3; i++) {
    if (actual[i] > minimum[i]) return true
    if (actual[i] < minimum[i]) return false
  }
  return true
}

function validateDiagnostics(data) {
  if (!isObject(data) || !semverAtLeast(data.version, MINIMUM_CLI_VERSION)
      || data.canonicalContractVersion !== CONTRACT_VERSION
      || !isBoolean(data.configured) || !isBoolean(data.authenticated)
      || !isBoolean(data.businessSelected) || !isString(data.timezone)
      || !isDate(data.localDate) || !isObject(data.commandBudgetsMs)
      || !Array.isArray(data.capabilities)) return false
  var budgetNames = ["read", "singleWrite", "multiSegment", "log", "switch"]
  for (var i = 0; i < budgetNames.length; i++)
    if (!isNonNegativeNumber(data.commandBudgetsMs[budgetNames[i]])
        || data.commandBudgetsMs[budgetNames[i]] === 0) return false
  var capabilities = ["semantic-guards", "canonical-tracking-v2", "mutation-receipts"]
  for (var j = 0; j < capabilities.length; j++)
    if (data.capabilities.indexOf(capabilities[j]) === -1) return false
  return true
}

function parseDocument(text) {
  if (!isString(text) || text.trim() === "") return null
  try { return JSON.parse(text) } catch (error) { return null }
}

function completion(request, outcome, field, value, processResult) {
  var result = {}
  var source = request || {}
  var keys = Object.keys(source)
  for (var i = 0; i < keys.length; i++) result[keys[i]] = source[keys[i]]
  result.outcome = outcome
  if (field) result[field] = value
  if (processResult && processResult.canceled === true) result.canceled = true
  return result
}

function classifiedError(request, code, message, uncertain, processResult, source) {
  var error = source || { code: code, message: message }
  return completion(request, uncertain ? "unknown" : "known-error", "error", error, processResult)
}

function isMutation(request) {
  return request && (request.requestKind === "mutation" || request.mutation === true)
}

function stdoutOf(result) {
  return result && (result.stdout !== undefined ? result.stdout : result.stdoutText)
}

function stderrOf(result) {
  return result && (result.stderr !== undefined ? result.stderr : result.stderrText)
}

function validateDeclaredError(error, request) {
  if (!isObject(error) || !isString(error.code) || error.code.length === 0
      || !isString(error.message) || error.message.length === 0) return false
  if (error.code === "GUARD_REJECTED") return validateGuardRejection(error)
  if (error.code === "TIMER_SWITCH_PARTIAL") {
    var details = error.details
    return isObject(details) && validateReceipt(details.partialReceipt, request)
      && hasOnly(details.startError, ["code", "message"])
      && isString(details.startError.code) && details.startError.code.length > 0
      && isString(details.startError.message) && details.startError.message.length > 0
      && details.partialReceipt.phase !== null
      && details.partialReceipt.phase.log === "confirmed"
      && details.partialReceipt.phase.start === "failed"
  }
  return true
}

function isDiagnosticsRequest(request) {
  if (!request) return false
  if (request.intent === "refreshDiagnostics" || request.queryKey === "diagnostics") return true
  return Array.isArray(request.argv) && request.argv[0] === "diagnostics"
}

function classifyProcessOutcome(request, processResult) {
  var result = processResult || {}
  var mutation = isMutation(request)
  if (result.responseTooLarge === true)
    return classifiedError(request, "CLI_RESPONSE_TOO_LARGE", "freshbooks-cli returned more data than the plugin accepts", mutation, result)
  if (result.timedOut === true)
    return classifiedError(request, "CLI_TIMEOUT", "freshbooks-cli did not finish before the deadline", mutation, result)
  if (result.exitStatus !== undefined && Number(result.exitStatus) !== 0)
    return classifiedError(request, "CLI_SIGNAL", "freshbooks-cli terminated unexpectedly", mutation, result)

  var stdoutDocument = parseDocument(stdoutOf(result))
  var stderrDocument = parseDocument(stderrOf(result))
  if (Number(result.exitCode || 0) !== 0) {
    if (!stderrDocument)
      return classifiedError(request, "CLI_EXIT", "freshbooks-cli exited without a valid error envelope", mutation, result)
    if (stderrDocument.schemaVersion !== ENVELOPE_SCHEMA_VERSION || stderrDocument.ok !== false)
      return classifiedError(request, "CLI_SCHEMA_MISMATCH", "freshbooks-cli error envelope is incompatible", mutation, result)
    var declared = stderrDocument.error
    if (!validateDeclaredError(declared, request))
      return classifiedError(request, "CLI_ERROR_SCHEMA_MISMATCH", "freshbooks-cli returned an invalid error", mutation, result)
    return completion(request, declared.outcomeUnknown === true ? "unknown" : "known-error", "error", declared, result)
  }

  if (!stdoutDocument)
    return classifiedError(request, "INVALID_JSON", "freshbooks-cli returned invalid JSON", mutation, result)
  if (stdoutDocument.schemaVersion !== ENVELOPE_SCHEMA_VERSION || stdoutDocument.ok !== true)
    return classifiedError(request, "CLI_SCHEMA_MISMATCH", "freshbooks-cli JSON schema is incompatible", mutation, result)

  if (mutation) {
    if (!validateReceipt(stdoutDocument.data, request))
      return classifiedError(request, "INVALID_MUTATION_RECEIPT", "freshbooks-cli returned an invalid mutation receipt", true, result)
    return completion(request, "receipt", "data", stdoutDocument.data, result)
  }
  if (isDiagnosticsRequest(request)) {
    if (!validateDiagnostics(stdoutDocument.data))
      return classifiedError(request, "CLI_DIAGNOSTICS_SCHEMA_MISMATCH", "freshbooks-cli diagnostics are incompatible", false, result)
    return completion(request, "observation", "data", stdoutDocument.data, result)
  }
  if (!validateObservation(stdoutDocument.data))
    return classifiedError(request, "CLI_RECORD_SCHEMA_MISMATCH", "freshbooks-cli returned an incompatible canonical observation", false, result)
  return completion(request, "observation", "data", stdoutDocument.data, result)
}

if (typeof module !== "undefined") module.exports = {
  validateDiagnostics: validateDiagnostics,
  validateObservation: validateObservation,
  validateReceipt: validateReceipt,
  validateGuardRejection: validateGuardRejection,
  classifyProcessOutcome: classifyProcessOutcome
}
