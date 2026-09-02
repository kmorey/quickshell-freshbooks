import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "TimeTrackingModel.js" as Model

Panel {
  id: root
  moduleName: "kmorey.freshbooks-time"
  ipcTarget: moduleName
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var timeTracking: null
  readonly property var barIdentity: hostWidget || root
  property string tab: "timer"
  property string projectSearch: ""
  property date today: new Date()
  property int viewYear: today.getFullYear()
  property int viewMonth: today.getMonth() + 1
  property string selectedDateKey: localDateKey(today)
  readonly property var monthCells: Model.calendarMonth(viewYear, viewMonth)
  readonly property var dayEntries: timeTracking ? Model.entriesForDay(timeTracking.entries, selectedDateKey) : []
  readonly property var orderedProjects: timeTracking
    ? Model.recentProjectOrder(timeTracking.projects, timeTracking.entries, timeTracking.activeTimer ? timeTracking.activeTimer.projectId : "")
    : []
  readonly property var projectShortcuts: Model.searchShortcuts(Model.projectShortcuts(orderedProjects), projectSearch)
  property string editingEntryId: ""
  property string entryProjectId: ""
  property string entryServiceId: ""
  property bool confirmingDelete: false
  property string entrySnapshotToken: ""
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property string consumerId: "freshbooks-panel-" + String(anchorItem)

  SystemClock {
    id: panelClock
    precision: SystemClock.Seconds
  }

  function localDateKey(date) {
    return Model.dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
  }

  function refresh() {
    if (!timeTracking) return
    var cells = monthCells
    timeTracking.refreshAll(cells.length ? cells[0].key : "", cells.length ? cells[cells.length - 1].key : "")
  }

  function open() {
    refresh()
    controller.show()
    if (timeTracking) timeTracking.registerVisibleConsumer(consumerId)
    Qt.callLater(function() { root.hydrateDrafts() })
  }

  function close() {
    if (timeTracking) timeTracking.unregisterVisibleConsumer(consumerId)
    controller.hide()
  }

  function closeForPopoutSwitch() {
    popoutSwitchClosing = true
    close()
    Qt.callLater(function() { popoutSwitchClosing = false })
  }

  function toggle() { opened ? close() : open() }

  function moveMonth(delta) {
    var date = new Date(Date.UTC(viewYear, viewMonth - 1 + delta, 1))
    viewYear = date.getUTCFullYear()
    viewMonth = date.getUTCMonth() + 1
    refresh()
  }

  function projectServiceId(project) {
    return project && Array.isArray(project.services) && project.services.length ? project.services[0].id : null
  }

  function hydrateDrafts() {
    if (!timeTracking) return
    var timer = timeTracking.activeTimer
    if (timer) {
      var matchingDraft = String(timeTracking.draftTimerId || "") === String(timer.id)
      noteField.text = matchingDraft && timeTracking.draftTimerNote !== "" ? timeTracking.draftTimerNote : String(timer.note || "")
      durationField.text = matchingDraft && timeTracking.draftTimerDuration !== "" ? timeTracking.draftTimerDuration : Model.formatDuration(timer.elapsedSeconds)
    } else {
      noteField.text = ""
      durationField.text = ""
    }
    var draft = timeTracking.entryDraft || {}
    if (String(draft.mode || "") !== "") {
      if (String(draft.selectedDate || "") !== "") selectedDateKey = String(draft.selectedDate)
      editingEntryId = String(draft.mode)
      entryProjectId = String(draft.projectId || "")
      entryServiceId = String(draft.serviceId || "")
      entrySnapshotToken = String(draft.snapshotToken || "")
      entryNoteField.text = String(draft.note || "")
      entryDurationField.text = String(draft.duration || "")
    }
  }

  function persistTimerDraft() {
    if (!timeTracking || !timeTracking.activeTimer) return
    timeTracking.draftTimerId = String(timeTracking.activeTimer.id)
    timeTracking.draftTimerNote = noteField.text
    timeTracking.draftTimerDuration = durationField.text
  }

  function persistEntryDraft() {
    if (!timeTracking || editingEntryId === "") return
    timeTracking.saveEntryDraft({
      mode: editingEntryId,
      projectId: entryProjectId,
      serviceId: entryServiceId,
      snapshotToken: entrySnapshotToken,
      note: entryNoteField.text,
      duration: entryDurationField.text,
      selectedDate: selectedDateKey
    })
  }

  function startProject(project) {
    if (!timeTracking) return
    var serviceId = projectServiceId(project)
    if (timeTracking.activeTimer) timeTracking.switchTimer(project.id, serviceId)
    else timeTracking.start(project.id, serviceId, "")
  }

  function startShortcut(shortcut) {
    if (!timeTracking || !shortcut) return
    if (timeTracking.activeTimer) timeTracking.switchTimer(shortcut.projectId, shortcut.serviceId)
    else timeTracking.start(shortcut.projectId, shortcut.serviceId, "")
  }

  function projectById(projectId) {
    for (var i = 0; timeTracking && i < timeTracking.projects.length; i++)
      if (String(timeTracking.projects[i].id) === String(projectId)) return timeTracking.projects[i]
    return null
  }

  function beginAddEntry() {
    var project = orderedProjects.length ? orderedProjects[0] : null
    editingEntryId = "new"
    entryProjectId = project ? String(project.id) : ""
    entryServiceId = projectServiceId(project) === null ? "" : String(projectServiceId(project))
    confirmingDelete = false
    entrySnapshotToken = ""
    entryNoteField.text = ""
    entryDurationField.text = "00:00"
    persistEntryDraft()
  }

  function beginEditEntry(entry) {
    editingEntryId = String(entry.id)
    entryProjectId = String(entry.projectId !== undefined ? entry.projectId : entry.project_id)
    entryServiceId = String(entry.serviceId !== undefined ? entry.serviceId : entry.service_id)
    confirmingDelete = false
    entrySnapshotToken = String(entry.snapshotToken || "")
    entryNoteField.text = String(entry.note || "")
    entryDurationField.text = Model.formatDuration(entry.durationSeconds !== undefined ? entry.durationSeconds : entry.duration || 0)
    persistEntryDraft()
  }

  function saveEntry() {
    var seconds = Model.parseDurationInput(entryDurationField.text)
    if (seconds === null || entryProjectId === "" || !timeTracking) return
    var fields = { durationSeconds: seconds, projectId: entryProjectId, serviceId: entryServiceId, note: entryNoteField.text }
    if (editingEntryId === "new") fields.startedAt = selectedDateKey + "T12:00:00"
    if (editingEntryId === "new") timeTracking.createEntry(fields)
    else timeTracking.updateEntry(editingEntryId, fields, entrySnapshotToken)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(root.tab === "calendar" ? 620 : 460))
    contentHeight: panel.fittedContentHeight(Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: noteField.activeFocus || durationField.activeFocus || searchField.activeFocus
      onCloseRequested: root.close()
      onTabRequested: function(direction) {
        var tabs = ["timer", "projects", "calendar"]
        var index = tabs.indexOf(root.tab)
        root.tab = tabs[(index + (direction > 0 ? 1 : 2)) % 3]
      }

      Column {
        anchors.fill: parent
        spacing: Style.space(10)

        Row {
          width: parent.width
          spacing: Style.space(6)

          Repeater {
            model: ["timer", "projects", "calendar"]
            Rectangle {
              required property string modelData
              width: (parent.width - Style.space(12)) / 3
              height: Style.space(34)
              radius: Style.cornerRadius
              color: root.tab === modelData ? Color.accent : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)
              Text { anchors.centerIn: parent; text: modelData.toUpperCase(); color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
              MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.tab = modelData }
            }
          }
        }

        Item {
          width: parent.width
          height: parent.height - Style.space(44)

          Column {
            visible: root.tab === "timer"
            anchors.fill: parent
            spacing: Style.space(12)

            Column {
              width: parent.width
              visible: root.timeTracking && root.timeTracking.timerMode === "multiple" && !root.timeTracking.activeTimer
              spacing: Style.space(4)
              Text { text: "Choose the FreshBooks timer to manage"; color: Color.urgent; font.family: root.fontFamily; font.bold: true }
              Repeater {
                model: root.timeTracking ? root.timeTracking.timers : []
                ActionButton {
                  required property var modelData
                  label: Model.formatDuration(modelData.elapsedSeconds) + "  " + String(modelData.note || "Untitled timer")
                  onTriggered: root.timeTracking.selectTimer(modelData.id)
                }
              }
            }

            Text {
              width: parent.width
              text: !root.timeTracking || !root.timeTracking.activeTimer ? "No active timer" : Model.formatDuration(Model.elapsedSeconds(root.timeTracking.activeTimer, panelClock.date.getTime()))
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              horizontalAlignment: Text.AlignHCenter
            }
            Text {
              width: parent.width
              text: root.timeTracking && root.timeTracking.activeTimer ? String(root.timeTracking.activeTimer.note || "Untitled work") : "Choose a project to begin"
              color: Qt.darker(root.foreground, 1.25)
              font.family: root.fontFamily
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
            }
            TextField {
              id: noteField
              width: parent.width
              enabled: root.timeTracking && root.timeTracking.activeTimer
              placeholderText: "Notes"
              onTextEdited: root.persistTimerDraft()
              onEditingFinished: if (root.timeTracking && enabled && text !== String(root.timeTracking.activeTimer.note || "")) root.timeTracking.updateTimerNote(text)
            }
            TextField {
              id: durationField
              width: parent.width
              enabled: root.timeTracking && root.timeTracking.activeTimer
              placeholderText: "HH:MM or HH:MM:SS"
              onTextEdited: root.persistTimerDraft()
              onAccepted: {
                var seconds = Model.parseDurationInput(text)
                if (seconds !== null && root.timeTracking) root.timeTracking.correctDuration(seconds)
              }
            }
            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(8)
              ActionButton {
                label: root.timeTracking && root.timeTracking.activeTimer && root.timeTracking.activeTimer.running ? "Pause" : "Resume"
                enabled: root.timeTracking && root.timeTracking.activeTimer && !root.timeTracking.busy
                onTriggered: {
                  if (root.timeTracking.activeTimer.running) root.timeTracking.pause()
                  else root.timeTracking.resume()
                }
              }
              ActionButton { label: "Log"; enabled: root.timeTracking && root.timeTracking.activeTimer && !root.timeTracking.busy; onTriggered: root.timeTracking.logTimer() }
              ActionButton { label: "Refresh"; enabled: root.timeTracking && !root.timeTracking.busy; onTriggered: root.refresh() }
            }
            Text {
              visible: root.timeTracking && root.timeTracking.lastError !== ""
              width: parent.width
              wrapMode: Text.Wrap
              text: root.timeTracking ? root.timeTracking.lastError : ""
              color: Color.urgent
              font.family: root.fontFamily
            }
            Row {
              visible: root.timeTracking && root.timeTracking.conflictPending
              spacing: Style.space(8)
              ActionButton {
                label: "Reload"
                onTriggered: {
                  root.timeTracking.resolveConflictReload()
                  Qt.callLater(function() {
                    if (root.timeTracking.activeTimer) {
                      noteField.text = String(root.timeTracking.activeTimer.note || "")
                      durationField.text = Model.formatDuration(root.timeTracking.activeTimer.elapsedSeconds)
                    }
                  })
                }
              }
              ActionButton { label: "Apply mine"; onTriggered: root.timeTracking.resolveConflictApplyMine() }
            }
          }

          Column {
            visible: root.tab === "projects"
            anchors.fill: parent
            spacing: Style.space(8)
            TextField { id: searchField; width: parent.width; placeholderText: "Search projects or clients"; text: root.projectSearch; onTextChanged: root.projectSearch = text }
            Flickable {
              width: parent.width
              height: parent.height - searchField.height - Style.space(8)
              contentHeight: projectColumn.implicitHeight
              clip: true
              Column {
                id: projectColumn
                width: parent.width
                spacing: Style.space(4)
                Repeater {
                  model: root.projectShortcuts
                  Rectangle {
                    required property var modelData
                    width: projectColumn.width
                    height: Style.space(46)
                    radius: Style.cornerRadius
                    color: projectMouse.containsMouse ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.12) : "transparent"
                    Text { anchors.left: parent.left; anchors.leftMargin: Style.space(10); anchors.verticalCenter: parent.verticalCenter; width: parent.width - Style.space(60); text: String(modelData.project.clientName || "") + (modelData.project.clientName ? " · " : "") + String(modelData.project.title || modelData.project.name || "Project") + (modelData.serviceName ? " · " + modelData.serviceName : ""); elide: Text.ElideRight; color: root.foreground; font.family: root.fontFamily }
                    Text { anchors.right: parent.right; anchors.rightMargin: Style.space(12); anchors.verticalCenter: parent.verticalCenter; text: root.timeTracking && root.timeTracking.activeTimer && String(root.timeTracking.activeTimer.projectId) === String(modelData.projectId) && String(root.timeTracking.activeTimer.serviceId) === String(modelData.serviceId) && root.timeTracking.activeTimer.running ? "Ⅱ" : "▶"; color: Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.title }
                    MouseArea { id: projectMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.startShortcut(modelData) }
                  }
                }
              }
            }
          }

          Column {
            visible: root.tab === "calendar"
            anchors.fill: parent
            spacing: Style.space(8)
            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(16)
              ActionButton { label: "‹"; onTriggered: root.moveMonth(-1) }
              Text { anchors.verticalCenter: parent.verticalCenter; text: Qt.formatDate(new Date(root.viewYear, root.viewMonth - 1, 1), "MMMM yyyy"); color: root.foreground; font.family: root.fontFamily; font.bold: true }
              ActionButton { label: "›"; onTriggered: root.moveMonth(1) }
            }
            Grid {
              id: calendarGrid
              columns: 7
              spacing: Style.space(3)
              Repeater {
                model: root.monthCells
                Rectangle {
                  required property var modelData
                  width: (panel.width - Style.space(36)) / 7
                  height: Style.space(45)
                  radius: Style.cornerRadius
                  color: root.selectedDateKey === modelData.key ? Color.accent : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, modelData.inMonth ? 0.07 : 0.025)
                  Text { anchors.horizontalCenter: parent.horizontalCenter; anchors.top: parent.top; anchors.topMargin: 4; text: modelData.day; color: modelData.inMonth ? root.foreground : Qt.darker(root.foreground, 1.7); font.family: root.fontFamily }
                  Text { anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 3; text: root.timeTracking ? Model.formatDuration((root.timeTracking.state.totals.byDay || {})[modelData.key] || 0).replace(/^00:/, "") : ""; color: root.foreground; opacity: text === "00:00" ? 0 : 0.7; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                  MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.selectedDateKey = modelData.key }
                }
              }
            }
            Row {
              width: parent.width
              Text { width: parent.width - addEntryButton.width; anchors.verticalCenter: parent.verticalCenter; text: root.selectedDateKey + " · " + Model.formatDuration(Model.reportingWeekTotal(root.timeTracking ? root.timeTracking.entries : [], root.selectedDateKey)) + " this week"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
              ActionButton { id: addEntryButton; label: "+ Entry"; onTriggered: root.beginAddEntry() }
            }
            Flickable {
              visible: root.editingEntryId === ""
              width: parent.width
              height: parent.height - calendarGrid.height - Style.space(86)
              contentHeight: entryColumn.implicitHeight
              clip: true
              Column {
                id: entryColumn
                width: parent.width
                spacing: Style.space(4)
                Repeater {
                  model: root.dayEntries
                  Rectangle {
                    required property var modelData
                    width: entryColumn.width
                    height: Style.space(38)
                    color: "transparent"
                    Text { anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter; width: parent.width - Style.space(100); text: String(modelData.note || "No notes"); color: root.foreground; elide: Text.ElideRight; font.family: root.fontFamily }
                    Text { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: Model.formatDuration(modelData.durationSeconds !== undefined ? modelData.durationSeconds : modelData.duration || 0); color: root.foreground; font.family: root.fontFamily }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.beginEditEntry(modelData) }
                  }
                }
              }
            }

            Column {
              visible: root.editingEntryId !== ""
              width: parent.width
              spacing: Style.space(7)
              Text { text: root.editingEntryId === "new" ? "Add time entry" : "Edit time entry"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
              TextField { id: entryNoteField; width: parent.width; placeholderText: "Notes"; onTextEdited: root.persistEntryDraft() }
              TextField { id: entryDurationField; width: parent.width; placeholderText: "HH:MM or HH:MM:SS"; onTextEdited: root.persistEntryDraft(); onAccepted: root.saveEntry() }
              Text { text: "Project and service"; color: Qt.darker(root.foreground, 1.3); font.family: root.fontFamily; font.pixelSize: Style.font.caption }
              Flickable {
                width: parent.width
                height: Style.space(100)
                contentHeight: entryProjectColumn.implicitHeight
                clip: true
                Column {
                  id: entryProjectColumn
                  width: parent.width
                  spacing: Style.space(3)
                  Repeater {
                    model: Model.projectShortcuts(root.orderedProjects)
                    Rectangle {
                      required property var modelData
                      width: entryProjectColumn.width
                      height: Style.space(30)
                      radius: Style.cornerRadius
                      color: String(root.entryProjectId) === String(modelData.projectId) && String(root.entryServiceId) === String(modelData.serviceId) ? Color.accent : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.07)
                      Text { anchors.centerIn: parent; width: parent.width - Style.space(12); horizontalAlignment: Text.AlignHCenter; elide: Text.ElideRight; text: String(modelData.project.title || modelData.project.name || "Project") + (modelData.serviceName ? " · " + modelData.serviceName : ""); color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
                      MouseArea { anchors.fill: parent; onClicked: { root.entryProjectId = String(modelData.projectId); root.entryServiceId = String(modelData.serviceId); root.persistEntryDraft() } }
                    }
                  }
                }
              }
              Row {
                spacing: Style.space(8)
                ActionButton { label: "Save"; enabled: Model.parseDurationInput(entryDurationField.text) !== null && root.entryProjectId !== ""; onTriggered: root.saveEntry() }
                ActionButton { label: "Cancel"; onTriggered: { root.editingEntryId = ""; root.confirmingDelete = false; if (root.timeTracking) root.timeTracking.clearEntryDraft() } }
                ActionButton {
                  visible: root.editingEntryId !== "new"
                  label: root.confirmingDelete ? "Delete now" : "Delete"
                  onTriggered: {
                    if (!root.confirmingDelete) root.confirmingDelete = true
                    else {
                      root.timeTracking.deleteEntry(root.editingEntryId)
                      root.editingEntryId = ""
                      root.confirmingDelete = false
                      root.timeTracking.clearEntryDraft()
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  component ActionButton: Rectangle {
    id: action
    property string label: ""
    signal triggered()
    implicitWidth: Math.max(Style.space(54), actionLabel.implicitWidth + Style.space(20))
    implicitHeight: Style.space(32)
    radius: Style.cornerRadius
    color: actionMouse.containsMouse ? Color.accent : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.1)
    opacity: enabled ? 1 : 0.45
    Text { id: actionLabel; anchors.centerIn: parent; text: action.label; color: root.foreground; font.family: root.fontFamily }
    MouseArea { id: actionMouse; anchors.fill: parent; hoverEnabled: true; enabled: action.enabled; cursorShape: Qt.PointingHandCursor; onClicked: action.triggered() }
  }

  Connections {
    target: root.timeTracking
    ignoreUnknownSignals: true
    function onActiveTimerChanged() { root.hydrateDrafts() }
    function onEntryDraftChanged() {
      if (!root.timeTracking || String((root.timeTracking.entryDraft || {}).mode || "") !== "") return
      root.editingEntryId = ""
      root.confirmingDelete = false
    }
  }

  Component.onCompleted: Qt.callLater(function() { root.hydrateDrafts() })
}
