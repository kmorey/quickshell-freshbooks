import QtQuick
import Quickshell.Io
import "CanonicalContract.js" as CanonicalContract

Item {
  id: root

  property string executable: "freshbooks"
  property int timeoutMs: 15000
  property int terminationGraceMs: 1000
  property int maxResponseBytes: 1048576
  property string activeRequestId: ""
  property var activeRequest: null
  property string pendingStdin: ""
  property string stdoutText: ""
  property string stderrText: ""
  property bool timedOut: false
  property bool responseTooLarge: false
  property bool readCanceled: false
  readonly property bool busy: cliProcess.running

  signal completed(var completion)

  function completeImmediately(request, error) {
    var completion = {}
    var keys = Object.keys(request || {})
    for (var i = 0; i < keys.length; i++) completion[keys[i]] = request[keys[i]]
    completion.outcome = "known-error"
    completion.error = error
    completed(completion)
  }

  function execute(request) {
    request = request || {}
    if (busy) {
      completeImmediately(request, {
        code: "ADAPTER_BUSY",
        message: "The FreshBooks CLI adapter is busy"
      })
      return false
    }
    var argv = Array.isArray(request.argv) ? request.argv.slice() : []
    activeRequestId = String(request.requestId || "")
    activeRequest = request
    pendingStdin = request.stdin !== undefined ? String(request.stdin) : ""
    stdoutText = ""
    stderrText = ""
    timedOut = false
    responseTooLarge = false
    readCanceled = false
    terminationWatchdog.stop()
    watchdog.interval = Number(request.deadlineMs) > 0 ? Number(request.deadlineMs) : timeoutMs
    cliProcess.command = [executable].concat(argv).concat(["--json"])
    cliProcess.running = true
    watchdog.restart()
    return true
  }

  function cancelRead(requestId) {
    if (!cliProcess.running || String(requestId) !== activeRequestId
        || !activeRequest || activeRequest.requestKind === "mutation"
        || activeRequest.mutation === true) return false
    readCanceled = true
    pendingStdin = ""
    cliProcess.running = false
    terminationWatchdog.restart()
    return true
  }

  function cancelTimedOut() {
    if (!cliProcess.running) return
    timedOut = true
    pendingStdin = ""
    cliProcess.running = false
    terminationWatchdog.restart()
  }

  function cancelOversized() {
    if (!cliProcess.running || responseTooLarge) return
    responseTooLarge = true
    pendingStdin = ""
    cliProcess.running = false
    terminationWatchdog.restart()
  }

  function finish(exitCode, exitStatus) {
    watchdog.stop()
    terminationWatchdog.stop()
    var request = activeRequest
    var processResult = {
      exitCode: Number(exitCode),
      exitStatus: Number(exitStatus),
      stdout: stdoutCollector.text || stdoutText,
      stderr: stderrCollector.text || stderrText,
      timedOut: timedOut,
      responseTooLarge: responseTooLarge,
      canceled: readCanceled
    }
    activeRequestId = ""
    activeRequest = null
    pendingStdin = ""
    completed(CanonicalContract.classifyProcessOutcome(request, processResult))
  }

  Timer {
    id: watchdog
    interval: root.timeoutMs
    repeat: false
    onTriggered: root.cancelTimedOut()
  }

  // Process.running = false sends SIGTERM. A CLI stalled in a signal handler
  // must not indefinitely retain the active request.
  Timer {
    id: terminationWatchdog
    interval: root.terminationGraceMs
    repeat: false
    onTriggered: if (cliProcess.running) cliProcess.signal(9)
  }

  Process {
    id: cliProcess
    running: false
    stdinEnabled: true
    command: []
    onStarted: {
      if (root.activeRequest && root.activeRequest.stdin !== undefined)
        write(root.pendingStdin + "\n")
      root.pendingStdin = ""
    }
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
    onExited: function(exitCode, exitStatus) {
      // Process.running can remain true until the exit signal returns.
      Qt.callLater(function() { root.finish(exitCode, exitStatus) })
    }
  }
}
