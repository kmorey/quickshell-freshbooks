import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import ".." as Plugin

ShellRoot {
  id: root

  property var remainingScript: []
  property var allRequests: []
  property var checkpoints: [
    { id: "SMOKE-1", text: "optimistic save closes editor immediately", state: "WAIT" },
    { id: "SMOKE-2", text: "canceled old observation never flashes or reverts", state: "WAIT" },
    { id: "SMOKE-3", text: "receipt settles without a follow-up read", state: "WAIT" },
    { id: "SMOKE-4", text: "note and duration conflict independently; unrelated entry stays enabled", state: "WAIT" },
    { id: "SMOKE-5", text: "deletion recovery activates Restore as new and Discard local", state: "WAIT" },
    { id: "SMOKE-6", text: "restart restores only unknown draft/lock and never retries mutation", state: "WAIT" },
    { id: "SMOKE-7", text: "running elapsed advances without changing serialized ledger", state: "WAIT" }
  ]
  property string phase: "loading-script"
  property string failure: ""
  property string ledgerBeforeTick: ""
  property int elapsedBeforeTick: -1
  property int mutationCountBeforeRestart: -1
  readonly property var stack: serviceLoader.item
  readonly property var service: stack ? stack.service : null
  readonly property var fake: stack ? stack.fake : null

  function setCheckpoint(id, passed, detail) {
    var next = checkpoints.slice()
    for (var i = 0; i < next.length; i++) {
      if (next[i].id !== id) continue
      next[i] = { id: next[i].id, text: next[i].text,
        state: passed ? "PASS" : "FAIL", detail: String(detail || "") }
      checkpoints = next
      if (!passed) fail(id + ": " + String(detail || "failed"))
      return
    }
  }

  function fail(message) {
    if (failure === "") failure = String(message)
    console.error("SMOOTH_SETTLEMENT_SMOKE failure: " + message)
  }

  function requestCount(kind) {
    var count = 0
    for (var i = 0; i < allRequests.length; i++)
      if (!kind || allRequests[i].requestKind === kind) count++
    return count
  }

  function operationState(scope) {
    var operations = service && service.view && service.view.operations || []
    for (var i = operations.length - 1; i >= 0; i--)
      if (String(operations[i].scope || "") === scope) return String(operations[i].state || "")
    return ""
  }

  function conflictFor(scope) {
    var conflicts = service && service.view && service.view.conflicts || []
    for (var i = conflicts.length - 1; i >= 0; i--)
      if (String(conflicts[i].scope || "") === scope) return conflicts[i]
    return null
  }

  function beginOptimisticScenario() {
    if (!service || phase !== "ready") return
    phase = "optimistic-old-read"
    service.refreshEntries("2026-10-01", "2026-10-01")
    Qt.callLater(function() {
      smokePanel.beginEditEntry(service.view.records["time-entry:9"])
      var accepted = service.updateEntry("9", { note: "Local optimistic" })
      if (accepted) smokePanel.cancelEntryEditor()
      var record = service.view.records["time-entry:9"]
      setCheckpoint("SMOKE-1", accepted && smokePanel.entryEditorMode === "closed"
        && record && record.note === "Local optimistic",
        "accepted=" + accepted + ", editor=" + smokePanel.entryEditorMode)
    })
  }

  function beginConflictScenario() {
    if (!service || checkpoints[2].state !== "PASS") return
    phase = "field-conflict"
    service.updateEntry("9", { note: "Mine note", durationSeconds: 7200 })
  }

  function beginRestoreConflict() {
    if (!service || phase !== "field-resolved") return
    phase = "restore-conflict"
    service.updateEntry("10", { note: "Restore me" })
  }

  function beginDiscardConflict() {
    if (!service || phase !== "restore-receipt") return
    phase = "discard-conflict"
    service.updateEntry("12", { note: "Discard me" })
  }

  function beginUnknownRestart() {
    if (!service || phase !== "deletions-resolved") return
    phase = "unknown-before-restart"
    mutationCountBeforeRestart = requestCount("mutation") + 1
    service.updateEntry("11", { note: "Unknown local" })
  }

  function restartService() {
    phase = "restarting"
    serviceLoader.active = false
    Qt.callLater(function() { serviceLoader.active = true })
  }

  function beginTickProof() {
    if (!service || checkpoints[5].state !== "PASS") return
    var timer = service.view.records["active-timer:timer-1"]
    ledgerBeforeTick = String(ledgerProbe.text() || "")
    elapsedBeforeTick = smokePanel.projectElapsedSeconds(timer, Date.now())
    phase = "ticking"
    tickProof.restart()
  }

  FileView {
    id: scriptFile
    path: Qt.resolvedUrl("smoke-script.json")
    printErrors: true
    onLoaded: {
      try {
        var document = JSON.parse(String(text() || ""))
        if (document.schemaVersion !== 1 || !Array.isArray(document.steps))
          throw new Error("unsupported smoke script")
        root.remainingScript = document.steps
        root.phase = "starting-service"
        serviceLoader.active = true
      } catch (error) {
        root.fail("cannot load smoke-script.json: " + String(error))
      }
    }
    onLoadFailed: root.fail("cannot read smoke-script.json")
  }

  FileView {
    id: ledgerProbe
    path: Quickshell.statePath("kmorey.freshbooks-operation-ledger.json")
    printErrors: false
  }

  Component {
    id: serviceComponent
    Item {
      id: serviceStack
      property alias service: productionService
      property alias fake: deterministicAdapter

      Plugin.FakeCliAdapter {
        id: deterministicAdapter
        script: root.remainingScript
        onRequestExecuted: function(request) {
          var next = root.allRequests.slice()
          next.push(request)
          root.allRequests = next
        }
        onStepCompleted: function(request, completion, remainingSteps) {
          root.remainingScript = deterministicAdapter.script
          if (root.phase === "optimistic-old-read" && completion.canceled === true) {
            var optimistic = productionService.view.records["time-entry:9"]
            root.setCheckpoint("SMOKE-2", optimistic && optimistic.note === "Local optimistic",
              "late delivery canceled=" + completion.canceled)
            root.phase = "optimistic-receipt"
          } else if (root.phase === "optimistic-receipt" && completion.outcome === "receipt") {
            Qt.callLater(function() {
              var before = root.requestCount()
              Qt.callLater(function() {
                root.setCheckpoint("SMOKE-3",
                  root.operationState("time-entry:9") === "settled" && root.requestCount() === before,
                  "requests after receipt=" + (root.requestCount() - before))
                root.phase = "optimistic-settled"
              })
            })
          } else if (root.phase === "restore-conflict" && completion.outcome === "known-error") {
            root.phase = "await-restore"
          } else if (root.phase === "await-restore" && completion.outcome === "receipt") {
            root.phase = "restore-receipt"
          } else if (root.phase === "discard-conflict" && completion.outcome === "known-error") {
            root.phase = "await-discard"
          }
        }
      }

      Plugin.Service {
        id: productionService
        cliAdapter: deterministicAdapter
      }
    }
  }

  Loader {
    id: serviceLoader
    active: false
    sourceComponent: serviceComponent
  }

  Plugin.Panel {
    id: smokePanel
    timeTracking: root.service
  }

  Timer {
    id: stateObserver
    interval: 50
    repeat: true
    running: true
    onTriggered: {
      if (!root.service) return
      if (root.phase === "starting-service" && root.service.diagnosticsReady) {
        root.phase = "loading-fixtures"
        root.service.refreshEntries("2026-10-01", "2026-10-01")
      } else if (root.phase === "loading-fixtures"
          && root.service.view.records["time-entry:9"]
          && !root.fake.busy) {
        root.phase = "ready"
      } else if (root.phase === "field-conflict") {
        var conflict = root.conflictFor("time-entry:9")
        if (conflict) {
          var groups = (conflict.groups || []).map(function(group) { return group.group }).sort()
          var otherAction = root.service.view.actions["time-entry:10"]
          root.setCheckpoint("SMOKE-4", JSON.stringify(groups) === JSON.stringify(["duration", "note"])
            && (!otherAction || otherAction.canMutate !== false), groups.join(", "))
          smokePanel.open()
          root.service.unregisterVisibleConsumer(smokePanel.consumerId)
          root.phase = "await-field-choices"
        }
      } else if (root.phase === "await-field-choices" && !root.conflictFor("time-entry:9")) {
        root.phase = "field-resolved"
      } else if (root.phase === "await-discard" && !root.conflictFor("time-entry:12")) {
        root.setCheckpoint("SMOKE-5", !!root.service.view.records["time-entry:110"]
          && !root.service.view.records["time-entry:12"], "both deletion actions persisted")
        root.phase = "deletions-resolved"
      } else if (root.phase === "unknown-before-restart"
          && root.operationState("time-entry:11") === "unknown"
          && root.fake.requests.length
          && root.fake.requests[root.fake.requests.length - 1].requestKind === "reconciliation") {
        root.restartService()
      } else if ((root.phase === "restarting" || root.phase === "restarted")
          && root.operationState("time-entry:11") === "unknown") {
        root.phase = "restarted"
        var record = root.service.view.records["time-entry:11"]
        var action = root.service.view.actions["time-entry:11"]
        root.setCheckpoint("SMOKE-6", record && record.note === "Unknown local"
          && action && action.canMutate === false
          && root.requestCount("mutation") === root.mutationCountBeforeRestart,
          "mutation requests=" + root.requestCount("mutation"))
      }
    }
  }

  Timer {
    id: tickProof
    interval: 1400
    repeat: false
    onTriggered: {
      var timer = root.service && root.service.view.records["active-timer:timer-1"]
      var elapsedAfter = smokePanel.projectElapsedSeconds(timer, Date.now())
      var ledgerAfter = String(ledgerProbe.text() || "")
      root.setCheckpoint("SMOKE-7", elapsedAfter > root.elapsedBeforeTick
        && ledgerAfter === root.ledgerBeforeTick,
        "elapsed " + root.elapsedBeforeTick + " → " + elapsedAfter
          + "; ledger bytes=" + ledgerAfter.length)
      root.phase = "finished"
    }
  }

  FloatingWindow {
    id: dashboard
    visible: true
    width: 760
    height: 650
    color: "#15171c"
    title: "Smooth settlement real-QML smoke"

    Rectangle {
      anchors.fill: parent
      color: "#15171c"
      focus: true

      ScrollView {
        anchors.fill: parent
        anchors.margins: 20
        contentWidth: availableWidth

        ColumnLayout {
          width: dashboard.width - 40
          spacing: 10

          Label { text: "Smooth conflict settlement · real QML"; color: "white"; font.pixelSize: 24; font.bold: true }
          Label { text: "Phase: " + root.phase; color: "#aab2c0" }
          Label { visible: root.failure !== ""; text: root.failure; color: "#ff6b6b"; wrapMode: Text.Wrap; Layout.fillWidth: true }

          Repeater {
            model: root.checkpoints
            delegate: Rectangle {
              required property var modelData
              Layout.fillWidth: true
              implicitHeight: row.implicitHeight + 16
              radius: 6
              color: modelData.state === "PASS" ? "#173b2b" : (modelData.state === "FAIL" ? "#4a2027" : "#252932")
              RowLayout {
                id: row
                anchors.fill: parent
                anchors.margins: 8
                Label { text: modelData.id; color: "white"; font.bold: true }
                Label { text: modelData.state; color: modelData.state === "PASS" ? "#72e0a0" : (modelData.state === "FAIL" ? "#ff8585" : "#aab2c0") }
                Label { text: modelData.text + (modelData.detail ? " — " + modelData.detail : ""); color: "white"; wrapMode: Text.Wrap; Layout.fillWidth: true }
              }
            }
          }

          Label { text: "Use Tab/Shift+Tab and Enter/Space for the keyboard path; click the same controls for the pointer path."; color: "#d8dee9"; wrapMode: Text.Wrap; Layout.fillWidth: true }

          Flow {
            Layout.fillWidth: true
            spacing: 8
            Button { objectName: "smokeOptimisticTarget"; text: "1–3 Optimism + receipt"; enabled: root.phase === "ready"; onClicked: root.beginOptimisticScenario() }
            Button { objectName: "smokeConflictTarget"; text: "4 Field conflict"; enabled: root.phase === "optimistic-settled"; onClicked: root.beginConflictScenario() }
            Button { objectName: "smokeRestoreTarget"; text: "5a Deletion / Restore"; enabled: root.phase === "field-resolved"; onClicked: root.beginRestoreConflict() }
            Button { objectName: "smokeDiscardTarget"; text: "5b Deletion / Discard"; enabled: root.phase === "restore-receipt"; onClicked: root.beginDiscardConflict() }
            Button { objectName: "smokeRestartTarget"; text: "6 Unknown + restart"; enabled: root.phase === "deletions-resolved"; onClicked: root.beginUnknownRestart() }
            Button { objectName: "smokeTickTarget"; text: "7 Running tick"; enabled: root.checkpoints[5].state === "PASS" && root.fake && !root.fake.busy && root.phase !== "ticking"; onClicked: root.beginTickProof() }
          }

          Label {
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            color: "#f3c969"
            text: root.phase === "await-field-choices"
              ? "ACTUAL PANEL TARGETS: choose Mine for note with the pointer, then FreshBooks for duration with keyboard focus + Enter."
              : (root.phase === "await-restore" ? "ACTUAL PANEL TARGET: activate Restore as new with the pointer."
              : (root.phase === "await-discard" ? "ACTUAL PANEL TARGET: focus Discard local and press Enter."
              : "The real Panel is instantiated below this harness and consumes the same production Service view."))
          }

          Button {
            objectName: "smokeFinishTarget"
            text: root.failure === "" ? "Finish smoke (exit 0)" : "Finish smoke (exit 1)"
            enabled: root.phase === "finished" || root.failure !== ""
            onClicked: Quickshell.exit(root.failure === "" ? 0 : 1)
          }
        }
      }
    }
  }

  Component.onCompleted: {
    if (String(Quickshell.env("SMOOTH_SETTLEMENT_SMOKE") || "") !== "1") {
      fail("development harness requires SMOOTH_SETTLEMENT_SMOKE=1")
      Quickshell.exit(64)
    }
  }
}
