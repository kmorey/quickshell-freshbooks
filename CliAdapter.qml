import QtQuick
import Quickshell.Io

Item {
  id: root

  property string executable: "freshbooks"
  property int timeoutMs: 15000
  property int maxResponseBytes: 1048576
  property string activeRequestId: ""
  property var activeRequest: null
  property string stdoutText: ""
  property string stderrText: ""
  property bool timedOut: false
  property bool responseTooLarge: false
  readonly property bool busy: cliProcess.running

  signal succeeded(string requestId, var data)
  signal failed(string requestId, var error)

  function execute(requestId, request) {
    if (busy) {
      failed(requestId, { code: "ADAPTER_BUSY", message: "The FreshBooks CLI adapter is busy" })
      return
    }
    var argv = request && Array.isArray(request.argv) ? request.argv.slice() : []
    activeRequestId = String(requestId)
    activeRequest = request
    stdoutText = ""
    stderrText = ""
    timedOut = false
    responseTooLarge = false
    cliProcess.command = [executable].concat(argv).concat(["--json"])
    cliProcess.running = true
    watchdog.restart()
  }

  function cancel() {
    if (!cliProcess.running) return
    timedOut = true
    cliProcess.running = false
  }

  function cancelOversized() {
    if (!cliProcess.running || responseTooLarge) return
    responseTooLarge = true
    cliProcess.running = false
  }

  function parseDocument(text) {
    var source = String(text || "").trim()
    if (source === "") return null
    try { return JSON.parse(source) } catch (error) { return null }
  }

  function validRecord(record, fields) {
    if (!record || typeof record !== "object") return false
    for (var i = 0; i < fields.length; i++) if (record[fields[i]] === undefined) return false
    return true
  }

  function validId(value) { return (typeof value === "number" && isFinite(value)) || (typeof value === "string" && value !== "") }
  function validTimer(record) {
    return validRecord(record, ["id", "running", "elapsedSeconds", "snapshotToken"])
      && validId(record.id) && typeof record.running === "boolean"
      && typeof record.elapsedSeconds === "number" && typeof record.snapshotToken === "string"
  }
  function validEntry(record) {
    return validRecord(record, ["id", "localDate", "durationSeconds", "snapshotToken"])
      && validId(record.id) && typeof record.localDate === "string"
      && typeof record.durationSeconds === "number" && typeof record.snapshotToken === "string"
  }

  function validData(request, data) {
    var intent = String(request && request.intent || "")
    if (intent === "refreshTimers") {
      if (!data || !Array.isArray(data.timers)) return false
      for (var i = 0; i < data.timers.length; i++)
        if (!validTimer(data.timers[i])) return false
    } else if (intent === "refreshProjects") {
      if (!Array.isArray(data)) return false
      for (var j = 0; j < data.length; j++)
        if (!validRecord(data[j], ["id", "title", "clientName", "services"]) || !validId(data[j].id)
            || typeof data[j].title !== "string" || typeof data[j].clientName !== "string" || !Array.isArray(data[j].services)) return false
    } else if (intent === "refreshEntries" || intent === "refreshRecentEntries") {
      if (!Array.isArray(data)) return false
      for (var k = 0; k < data.length; k++)
        if (!validEntry(data[k])) return false
    } else if (intent === "refreshDiagnostics") {
      return validRecord(data, ["version", "authenticated", "businessSelected", "capabilities", "localDate"])
        && typeof data.version === "string" && typeof data.authenticated === "boolean"
        && typeof data.businessSelected === "boolean" && Array.isArray(data.capabilities)
        && /^\d{4}-\d{2}-\d{2}$/.test(data.localDate)
    } else if (["start", "pause", "resume", "correctDuration", "updateTimerNote"].indexOf(intent) !== -1) {
      return validTimer(data)
    } else if (intent === "log") {
      return validEntry(data) && validId(data.timerId)
    } else if (intent === "switch") {
      return validRecord(data, ["timer", "partial"]) && typeof data.partial === "boolean" && validTimer(data.timer)
    } else if (intent === "createEntry" || intent === "updateEntry") {
      return validEntry(data)
    } else if (intent === "deleteEntry") {
      return validRecord(data, ["id", "deleted"])
    }
    return true
  }

  function finish(exitCode, exitStatus) {
    watchdog.stop()
    var requestId = activeRequestId
    var request = activeRequest
    var stdoutDocument = parseDocument(stdoutCollector.text || stdoutText)
    var stderrDocument = parseDocument(stderrCollector.text || stderrText)
    activeRequestId = ""
    activeRequest = null

    if (responseTooLarge) {
      failed(requestId, {
        code: "CLI_RESPONSE_TOO_LARGE",
        message: "freshbooks-cli returned more data than the plugin accepts",
        outcomeUnknown: request && request.mutation === true
      })
      return
    }
    if (timedOut) {
      failed(requestId, {
        code: "CLI_TIMEOUT",
        message: "freshbooks-cli did not finish before the timeout",
        outcomeUnknown: request && request.mutation === true
      })
      return
    }
    if (exitStatus !== undefined && Number(exitStatus) !== 0) {
      failed(requestId, {
        code: "CLI_SIGNAL",
        message: "freshbooks-cli terminated unexpectedly",
        outcomeUnknown: request && request.mutation === true
      })
      return
    }
    if (exitCode !== 0) {
      var declared = stderrDocument && stderrDocument.error ? stderrDocument.error : null
      failed(requestId, declared || {
        code: "CLI_EXIT",
        message: "freshbooks-cli exited with status " + exitCode,
        exitCode: exitCode,
        outcomeUnknown: request && request.mutation === true
      })
      return
    }
    if (!stdoutDocument) {
      failed(requestId, { code: "INVALID_JSON", message: "freshbooks-cli returned invalid JSON", outcomeUnknown: request && request.mutation === true })
      return
    }
    if (stdoutDocument.schemaVersion !== 1) {
      failed(requestId, {
        code: "CLI_SCHEMA_MISMATCH",
        message: "freshbooks-cli JSON schema is incompatible; version 0.2.0 or newer is required",
        outcomeUnknown: request && request.mutation === true
      })
      return
    }
    if (stdoutDocument.ok !== true) {
      failed(requestId, stdoutDocument.error || { code: "CLI_ERROR", message: "freshbooks-cli reported an error" })
      return
    }
    if (!validData(request, stdoutDocument.data)) {
      failed(requestId, { code: "CLI_RECORD_SCHEMA_MISMATCH", message: "freshbooks-cli returned an incompatible record", outcomeUnknown: request && request.mutation === true })
      return
    }
    succeeded(requestId, stdoutDocument.data)
  }

  Timer {
    id: watchdog
    interval: root.timeoutMs
    repeat: false
    onTriggered: root.cancel()
  }

  Process {
    id: cliProcess
    running: false
    command: []
    stdout: StdioCollector {
      id: stdoutCollector
      waitForEnd: true
      onStreamFinished: root.stdoutText = text
      onTextChanged: if (text.length > root.maxResponseBytes) root.cancelOversized()
    }
    stderr: StdioCollector {
      id: stderrCollector
      waitForEnd: true
      onStreamFinished: root.stderrText = text
      onTextChanged: if (text.length > root.maxResponseBytes) root.cancelOversized()
    }
    onExited: function(exitCode, exitStatus) { root.finish(exitCode, exitStatus) }
  }
}
