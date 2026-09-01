import QtQuick
import Quickshell.Io

Item {
  id: root

  property string executable: "freshbooks"
  property int timeoutMs: 15000
  property string activeRequestId: ""
  property var activeRequest: null
  property string stdoutText: ""
  property string stderrText: ""
  property bool timedOut: false
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
    cliProcess.command = [executable].concat(argv).concat(["--json"])
    cliProcess.running = true
    watchdog.restart()
  }

  function cancel() {
    if (!cliProcess.running) return
    timedOut = true
    cliProcess.running = false
  }

  function parseDocument(text) {
    var source = String(text || "").trim()
    if (source === "") return null
    try { return JSON.parse(source) } catch (error) { return null }
  }

  function finish(exitCode) {
    watchdog.stop()
    var requestId = activeRequestId
    var stdoutDocument = parseDocument(stdoutCollector.text || stdoutText)
    var stderrDocument = parseDocument(stderrCollector.text || stderrText)
    activeRequestId = ""
    activeRequest = null

    if (timedOut) {
      failed(requestId, {
        code: "CLI_TIMEOUT",
        message: "freshbooks-cli did not finish before the timeout",
        outcomeUnknown: true
      })
      return
    }
    if (exitCode !== 0) {
      var declared = stderrDocument && stderrDocument.error ? stderrDocument.error : null
      failed(requestId, declared || {
        code: "CLI_EXIT",
        message: "freshbooks-cli exited with status " + exitCode,
        exitCode: exitCode
      })
      return
    }
    if (!stdoutDocument) {
      failed(requestId, { code: "INVALID_JSON", message: "freshbooks-cli returned invalid JSON" })
      return
    }
    if (stdoutDocument.ok !== true) {
      failed(requestId, stdoutDocument.error || { code: "CLI_ERROR", message: "freshbooks-cli reported an error" })
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
    }
    stderr: StdioCollector {
      id: stderrCollector
      waitForEnd: true
      onStreamFinished: root.stderrText = text
    }
    onExited: function(exitCode) { root.finish(exitCode) }
  }
}
