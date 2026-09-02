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
  property int keyboardCursor: 0
  property bool calendarGridFocused: true
  property date today: new Date()
  property int viewYear: today.getFullYear()
  property int viewMonth: today.getMonth() + 1
  property string selectedDateKey: localDateKey(today)
  property string calendarCursorDateKey: selectedDateKey
  readonly property string todayDateKey: timeTracking && String((timeTracking.diagnostics || {}).localDate || "") !== ""
    ? String(timeTracking.diagnostics.localDate) : localDateKey(today)
  readonly property var monthCells: Model.calendarMonth(viewYear, viewMonth)
  readonly property var dayEntries: timeTracking ? Model.entriesForDay(timeTracking.entries, selectedDateKey) : []
  readonly property var orderedProjects: timeTracking
    ? Model.recentProjectOrder(timeTracking.projects, timeTracking.recentEntries, timeTracking.activeTimer ? timeTracking.activeTimer.projectId : "")
    : []
  readonly property var projectShortcuts: Model.searchShortcuts(Model.projectShortcuts(orderedProjects), projectSearch)
  property string entryEditorMode: "closed"
  property string editingEntryId: ""
  property string entryProjectId: ""
  property string entryServiceId: ""
  property string entryDateKey: ""
  property string entryOriginalDateKey: ""
  property bool entryDraftDirty: false
  property bool confirmingDelete: false
  property string entrySnapshotToken: ""
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property string consumerId: "freshbooks-panel-" + String(anchorItem)
  readonly property bool canMutate: timeTracking && !timeTracking.busy && !timeTracking.outcomeUnknown && !timeTracking.conflictPending

  SystemClock {
    id: panelClock
    precision: SystemClock.Seconds
  }

  function localDateKey(date) {
    return Model.dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
  }

  function refresh() {
    if (!timeTracking) return
    if (timeTracking.outcomeUnknown && timeTracking.retryUnknownRefresh()) return
    var cells = monthCells
    timeTracking.refreshAll(cells.length ? cells[0].key : "", cells.length ? cells[cells.length - 1].key : "")
  }

  function open() {
    hydrateDrafts()
    refresh()
    controller.show()
    if (timeTracking) timeTracking.registerVisibleConsumer(consumerId)
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

  function switchTab(direction) {
    var tabs = ["timer", "projects", "calendar"]
    var index = tabs.indexOf(tab)
    tab = tabs[(index + (direction > 0 ? 1 : 2)) % 3]
    keyboardCursor = 0
    calendarGridFocused = tab === "calendar"
  }

  function moveKeyboardCursor(dx, dy) {
    if (tab === "calendar" && calendarGridFocused) {
      calendarCursorDateKey = Model.addDays(calendarCursorDateKey, dx + dy * 7)
      var cursor = Model.parseDateKey(calendarCursorDateKey)
      if (cursor && (cursor.year !== viewYear || cursor.month !== viewMonth)) {
        viewYear = cursor.year
        viewMonth = cursor.month
        refresh()
      }
      return
    }
    if (dx !== 0) { switchTab(dx); return }
    var count = tab === "timer" ? 5 : (tab === "projects" ? projectShortcuts.length : Math.max(1, dayEntries.length + 1))
    keyboardCursor = Math.max(0, Math.min(count - 1, keyboardCursor + dy))
    if (tab === "calendar" && keyboardCursor === 0 && dy < 0) calendarGridFocused = true
  }

  function activateKeyboardCursor() {
    if (!timeTracking || timeTracking.busy) return
    if (tab === "timer") {
      if (keyboardCursor === 0) noteField.forceActiveFocus()
      else if (keyboardCursor === 1) durationField.forceActiveFocus()
      else if (keyboardCursor === 2 && timeTracking.activeTimer) timeTracking.activeTimer.running ? timeTracking.pause() : timeTracking.resume()
      else if (keyboardCursor === 3 && timeTracking.activeTimer) timeTracking.logTimer()
      else if (keyboardCursor === 4) refresh()
    } else if (tab === "projects" && projectShortcuts.length) {
      startShortcut(projectShortcuts[Math.min(keyboardCursor, projectShortcuts.length - 1)])
    } else if (tab === "calendar") {
      if (calendarGridFocused) {
        selectedDateKey = calendarCursorDateKey
        calendarGridFocused = false
        keyboardCursor = 0
      } else if (keyboardCursor === 0) beginAddEntry()
      else if (dayEntries.length) beginEditEntry(dayEntries[Math.min(keyboardCursor - 1, dayEntries.length - 1)])
    }
  }

  function deleteKeyboardSelection() {
    if (tab !== "calendar") return
    if (entryEditorMode === "closed" && !calendarGridFocused && keyboardCursor > 0 && dayEntries.length) {
      beginEditEntry(dayEntries[Math.min(keyboardCursor - 1, dayEntries.length - 1)])
    }
    if (entryEditorMode !== "edit") return
    confirmingDelete = true
    Qt.callLater(function() { deleteEntryButton.forceActiveFocus() })
  }

  function cancelEntryEditor() {
    if (confirmingDelete) { confirmingDelete = false; return }
    entryEditorMode = "closed"
    editingEntryId = ""
    if (timeTracking) timeTracking.clearEntryDraft()
  }

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
      noteField.text = matchingDraft && timeTracking.draftTimerNoteDirty ? timeTracking.draftTimerNote : String(timer.note || "")
      durationField.text = matchingDraft && timeTracking.draftTimerDurationDirty ? timeTracking.draftTimerDuration : Model.formatDuration(timer.elapsedSeconds)
    } else {
      noteField.text = ""
      durationField.text = ""
    }
    var draft = timeTracking.entryDraft || {}
    if (String(draft.mode || "") !== "") {
      if (String(draft.selectedDate || "") !== "") {
        selectedDateKey = String(draft.selectedDate)
        var selected = Model.parseDateKey(selectedDateKey)
        if (selected) { viewYear = selected.year; viewMonth = selected.month }
      }
      var storedMode = String(draft.mode)
      entryEditorMode = storedMode === "new" ? "create" : (storedMode === "create" || storedMode === "edit" ? storedMode : "edit")
      editingEntryId = entryEditorMode === "edit" ? String(draft.entryId || (storedMode !== "edit" ? storedMode : "")) : ""
      entryProjectId = String(draft.projectId || "")
      entryServiceId = String(draft.serviceId || "")
      entrySnapshotToken = String(draft.snapshotToken || "")
      entryDateKey = String(draft.entryDate || draft.selectedDate || selectedDateKey)
      entryOriginalDateKey = String(draft.originalDate || entryDateKey)
      entryDraftDirty = draft.dirty === true
      entryDateField.text = entryDateKey
      entryNoteField.text = String(draft.note || "")
      entryDurationField.text = String(draft.duration || "")
    }
  }

  function persistTimerNoteDraft() {
    if (!timeTracking || !timeTracking.activeTimer) return
    timeTracking.draftTimerId = String(timeTracking.activeTimer.id)
    timeTracking.draftTimerSnapshotToken = String(timeTracking.activeTimer.snapshotToken || "")
    timeTracking.draftTimerNote = noteField.text
    timeTracking.draftTimerNoteDirty = true
  }

  function persistTimerDurationDraft() {
    if (!timeTracking || !timeTracking.activeTimer) return
    timeTracking.draftTimerId = String(timeTracking.activeTimer.id)
    timeTracking.draftTimerSnapshotToken = String(timeTracking.activeTimer.snapshotToken || "")
    timeTracking.draftTimerDuration = durationField.text
    timeTracking.draftTimerDurationDirty = true
  }

  function persistEntryDraft(markDirty) {
    if (!timeTracking || entryEditorMode === "closed") return
    if (markDirty === true) entryDraftDirty = true
    timeTracking.saveEntryDraft({
      mode: entryEditorMode,
      entryId: editingEntryId,
      projectId: entryProjectId,
      serviceId: entryServiceId,
      snapshotToken: entrySnapshotToken,
      note: entryNoteField.text,
      duration: entryDurationField.text,
      selectedDate: selectedDateKey,
      entryDate: entryDateKey,
      originalDate: entryOriginalDateKey,
      dirty: entryDraftDirty
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
    var active = timeTracking.activeTimer
    var sameShortcut = active && String(active.projectId) === String(shortcut.projectId)
      && String(active.serviceId) === String(shortcut.serviceId)
    if (sameShortcut) {
      if (active.running) timeTracking.pause()
      else timeTracking.resume()
    } else if (active) timeTracking.switchTimer(shortcut.projectId, shortcut.serviceId)
    else timeTracking.start(shortcut.projectId, shortcut.serviceId, "")
  }

  function projectById(projectId) {
    for (var i = 0; timeTracking && i < timeTracking.projects.length; i++)
      if (String(timeTracking.projects[i].id) === String(projectId)) return timeTracking.projects[i]
    return null
  }

  function beginAddEntry() {
    var project = orderedProjects.length ? orderedProjects[0] : null
    entryEditorMode = "create"
    editingEntryId = ""
    entryProjectId = project ? String(project.id) : ""
    entryServiceId = projectServiceId(project) === null ? "" : String(projectServiceId(project))
    entryDateKey = selectedDateKey
    entryOriginalDateKey = ""
    entryDraftDirty = true
    confirmingDelete = false
    entrySnapshotToken = ""
    entryNoteField.text = ""
    entryDurationField.text = "00:00"
    persistEntryDraft(true)
  }

  function beginEditEntry(entry) {
    entryEditorMode = "edit"
    editingEntryId = String(entry.id)
    entryProjectId = String(entry.projectId === null ? "" : entry.projectId)
    entryServiceId = String(entry.serviceId === null ? "" : entry.serviceId)
    entryDateKey = String(entry.localDate || selectedDateKey)
    entryOriginalDateKey = entryDateKey
    entryDraftDirty = false
    confirmingDelete = false
    entrySnapshotToken = String(entry.snapshotToken || "")
    entryNoteField.text = String(entry.note || "")
    entryDurationField.text = Model.formatDuration(entry.durationSeconds || 0)
    persistEntryDraft(false)
  }

  function adoptCleanEntryEditor() {
    if (!timeTracking || entryEditorMode !== "edit" || entryDraftDirty) return
    for (var i = 0; i < timeTracking.entries.length; i++) {
      var entry = timeTracking.entries[i]
      if (String(entry.id) !== String(editingEntryId)) continue
      entryProjectId = String(entry.projectId === null ? "" : entry.projectId)
      entryServiceId = String(entry.serviceId === null ? "" : entry.serviceId)
      entryDateKey = String(entry.localDate || selectedDateKey)
      entryOriginalDateKey = entryDateKey
      entrySnapshotToken = String(entry.snapshotToken || "")
      entryDateField.text = entryDateKey
      entryNoteField.text = String(entry.note || "")
      entryDurationField.text = Model.formatDuration(entry.durationSeconds || 0)
      persistEntryDraft(false)
      return
    }
    entryEditorMode = "closed"
    editingEntryId = ""
    timeTracking.clearEntryDraft()
  }

  function saveEntry() {
    var seconds = Model.parseDurationInput(entryDurationField.text)
    if (seconds === null || entryProjectId === "" || !Model.parseDateKey(entryDateKey) || !timeTracking) return
    var fields = { durationSeconds: seconds, projectId: entryProjectId, serviceId: entryServiceId, note: entryNoteField.text }
    if (entryEditorMode === "create" || entryDateKey !== entryOriginalDateKey) fields.localDate = entryDateKey
    if (entryEditorMode === "create") timeTracking.createEntry(fields)
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
      blocked: noteField.activeFocus || durationField.activeFocus || searchField.activeFocus || root.entryEditorMode !== "closed"
      onCloseRequested: root.close()
      onMoveRequested: function(dx, dy) { root.moveKeyboardCursor(dx, dy) }
      onActivateRequested: root.activateKeyboardCursor()
      onDeleteRequested: root.deleteKeyboardSelection()
      onTextKey: function(text) { if (root.tab === "calendar" && (text === "g" || text === "G")) root.calendarGridFocused = true }
      onTabRequested: function(direction) {
        root.switchTab(direction)
      }

      Column {
        anchors.fill: parent
        spacing: Style.space(10)

        Text {
          visible: root.timeTracking && (!root.timeTracking.diagnosticsReady || (root.timeTracking.diagnostics || {}).authenticated !== true || (root.timeTracking.diagnostics || {}).businessSelected !== true)
          width: parent.width
          wrapMode: Text.Wrap
          text: root.timeTracking && !root.timeTracking.diagnosticsReady
            ? "freshbooks-cli 0.2.0+ is missing or incompatible. Install/update it in a terminal, then refresh."
            : ((root.timeTracking.diagnostics || {}).authenticated !== true
                ? "FreshBooks setup required. Run `freshbooks auth login` in a terminal."
                : "Choose an account in a terminal with `freshbooks business use ID`.")
          color: Color.urgent
          font.family: root.fontFamily
        }

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
              MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { root.tab = modelData; root.keyboardCursor = 0; root.calendarGridFocused = modelData === "calendar" } }
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
              text: {
                if (!root.timeTracking || !root.timeTracking.activeTimer) return ""
                var project = root.projectById(root.timeTracking.activeTimer.projectId)
                return project ? String(project.clientName || "Internal") + " · " + String(project.title || "Project") : ""
              }
              color: Qt.darker(root.foreground, 1.25)
              font.family: root.fontFamily
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
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
              onTextEdited: root.persistTimerNoteDraft()
              onEditingFinished: if (root.timeTracking && enabled && text !== String(root.timeTracking.activeTimer.note || "")) root.timeTracking.updateTimerNote(text)
            }
            TextField {
              id: durationField
              width: parent.width
              enabled: root.timeTracking && root.timeTracking.activeTimer
              placeholderText: "HH:MM or HH:MM:SS"
              onTextEdited: root.persistTimerDurationDraft()
              onEditingFinished: {
                var seconds = Model.parseDurationInput(text)
                if (seconds !== null && root.timeTracking && root.timeTracking.draftTimerDurationDirty && !root.timeTracking.busy) root.timeTracking.correctDuration(seconds)
                else if (root.timeTracking && root.timeTracking.activeTimer) text = Model.formatDuration(Model.elapsedSeconds(root.timeTracking.activeTimer, panelClock.date.getTime()))
              }
            }
            Text { visible: root.timeTracking && root.timeTracking.busy; text: "Saving or refreshing…"; color: Qt.darker(root.foreground, 1.25); font.family: root.fontFamily; horizontalAlignment: Text.AlignHCenter; width: parent.width }
            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(8)
              ActionButton {
                cursorIndex: 2
                selected: root.tab === "timer" && root.keyboardCursor === 2
                label: root.timeTracking && root.timeTracking.activeTimer && root.timeTracking.activeTimer.running ? "Pause" : "Resume"
                enabled: root.canMutate && root.timeTracking.activeTimer
                onTriggered: {
                  if (root.timeTracking.activeTimer.running) root.timeTracking.pause()
                  else root.timeTracking.resume()
                }
              }
              ActionButton { cursorIndex: 3; selected: root.tab === "timer" && root.keyboardCursor === 3; label: "Log"; enabled: root.canMutate && root.timeTracking.activeTimer; onTriggered: root.timeTracking.logTimer() }
              ActionButton { cursorIndex: 4; selected: root.tab === "timer" && root.keyboardCursor === 4; label: "Refresh"; enabled: root.timeTracking && !root.timeTracking.busy; onTriggered: root.refresh() }
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
                    required property int index
                    width: projectColumn.width
                    height: Style.space(46)
                    radius: Style.cornerRadius
                    color: projectMouse.containsMouse || root.keyboardCursor === index ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.12) : "transparent"
                    border.width: root.keyboardCursor === index ? 1 : 0
                    border.color: Color.accent
                    Text { anchors.left: parent.left; anchors.leftMargin: Style.space(10); anchors.verticalCenter: parent.verticalCenter; width: parent.width - Style.space(60); text: String(modelData.project.clientName || "") + (modelData.project.clientName ? " · " : "") + String(modelData.project.title || modelData.project.name || "Project") + (modelData.serviceName ? " · " + modelData.serviceName : ""); elide: Text.ElideRight; color: root.foreground; font.family: root.fontFamily }
                    Text { anchors.right: parent.right; anchors.rightMargin: Style.space(12); anchors.verticalCenter: parent.verticalCenter; text: root.timeTracking && root.timeTracking.activeTimer && String(root.timeTracking.activeTimer.projectId) === String(modelData.projectId) && String(root.timeTracking.activeTimer.serviceId) === String(modelData.serviceId) && root.timeTracking.activeTimer.running ? "Ⅱ" : "▶"; color: Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.title }
                    MouseArea { id: projectMouse; anchors.fill: parent; hoverEnabled: true; enabled: root.canMutate; cursorShape: Qt.PointingHandCursor; onContainsMouseChanged: if (containsMouse) root.keyboardCursor = index; onClicked: root.startShortcut(modelData) }
                  }
                }
              }
            }
          }

          Column {
            visible: root.tab === "calendar"
            anchors.fill: parent
            spacing: Style.space(8)
            Text {
              width: parent.width
              visible: root.timeTracking && root.timeTracking.activeTimer
              text: "Active timer · " + Model.formatDuration(Model.elapsedSeconds(root.timeTracking.activeTimer, panelClock.date.getTime())) + " · not included in totals"
              color: Color.accent
              font.family: root.fontFamily
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
            }
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
                  border.width: root.calendarCursorDateKey === modelData.key ? 2 : (root.todayDateKey === modelData.key ? 1 : 0)
                  border.color: root.calendarCursorDateKey === modelData.key ? root.foreground : Color.accent
                  Text { anchors.horizontalCenter: parent.horizontalCenter; anchors.top: parent.top; anchors.topMargin: 4; text: modelData.day; color: modelData.inMonth ? root.foreground : Qt.darker(root.foreground, 1.7); font.family: root.fontFamily }
                  Text { anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 3; text: root.timeTracking ? Model.formatDuration((root.timeTracking.state.totals.byDay || {})[modelData.key] || 0).replace(/^00:/, "") : ""; color: root.foreground; opacity: text === "00:00" ? 0 : 0.7; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                  Rectangle { visible: root.timeTracking && Model.entriesForDay(root.timeTracking.entries, modelData.key).length > 0; width: 4; height: 4; radius: 2; color: root.foreground; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 4 }
                  MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onContainsMouseChanged: {
                      if (!containsMouse) return
                      root.calendarCursorDateKey = modelData.key
                      root.calendarGridFocused = true
                    }
                    onClicked: {
                      root.selectedDateKey = modelData.key
                      root.calendarCursorDateKey = modelData.key
                      root.calendarGridFocused = true
                      root.keyboardCursor = 0
                    }
                  }
                }
              }
            }
            Row {
              width: parent.width
              Text { width: parent.width - addEntryButton.width; anchors.verticalCenter: parent.verticalCenter; text: root.selectedDateKey + " · " + Model.formatDuration(Model.reportingWeekTotal(root.timeTracking ? root.timeTracking.entries : [], root.selectedDateKey)) + " this week"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
              ActionButton { id: addEntryButton; cursorIndex: 0; selected: root.tab === "calendar" && !root.calendarGridFocused && root.keyboardCursor === 0; label: "+ Entry"; onHovered: root.calendarGridFocused = false; onTriggered: root.beginAddEntry() }
            }
            Flickable {
              visible: root.entryEditorMode === "closed"
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
                    required property int index
                    width: entryColumn.width
                    height: Style.space(38)
                    color: "transparent"
                    border.width: root.keyboardCursor === index + 1 ? 1 : 0
                    border.color: Color.accent
                    Text { anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter; width: parent.width - Style.space(100); text: String(modelData.note || "No notes"); color: root.foreground; elide: Text.ElideRight; font.family: root.fontFamily }
                    Text { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: Model.formatDuration(modelData.durationSeconds !== undefined ? modelData.durationSeconds : modelData.duration || 0); color: root.foreground; font.family: root.fontFamily }
                    MouseArea {
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onContainsMouseChanged: {
                        if (!containsMouse) return
                        root.keyboardCursor = index + 1
                        root.calendarGridFocused = false
                      }
                      onClicked: root.beginEditEntry(modelData)
                    }
                  }
                }
              }
            }

            Column {
              visible: root.entryEditorMode !== "closed"
              width: parent.width
              spacing: Style.space(7)
              Keys.onEscapePressed: root.cancelEntryEditor()
              Text { text: root.entryEditorMode === "create" ? "Add time entry" : "Edit time entry"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
              TextField { id: entryDateField; width: parent.width; placeholderText: "YYYY-MM-DD"; text: root.entryDateKey; onTextEdited: { root.entryDateKey = text; root.persistEntryDraft(true) } }
              TextField { id: entryNoteField; width: parent.width; placeholderText: "Notes"; onTextEdited: root.persistEntryDraft(true) }
              TextField { id: entryDurationField; width: parent.width; placeholderText: "HH:MM or HH:MM:SS"; onTextEdited: root.persistEntryDraft(true); onAccepted: root.saveEntry() }
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
                      activeFocusOnTab: true
                      color: String(root.entryProjectId) === String(modelData.projectId) && String(root.entryServiceId) === String(modelData.serviceId) ? Color.accent : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.07)
                      Text { anchors.centerIn: parent; width: parent.width - Style.space(12); horizontalAlignment: Text.AlignHCenter; elide: Text.ElideRight; text: String(modelData.project.clientName || "Internal") + " · " + String(modelData.project.title || "Project") + (modelData.serviceName ? " · " + modelData.serviceName : ""); color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
                      MouseArea { anchors.fill: parent; onClicked: { root.entryProjectId = String(modelData.projectId); root.entryServiceId = String(modelData.serviceId); root.persistEntryDraft(true) } }
                      Keys.onReturnPressed: { root.entryProjectId = String(modelData.projectId); root.entryServiceId = String(modelData.serviceId); root.persistEntryDraft(true) }
                      Keys.onSpacePressed: { root.entryProjectId = String(modelData.projectId); root.entryServiceId = String(modelData.serviceId); root.persistEntryDraft(true) }
                    }
                  }
                }
              }
              Row {
                spacing: Style.space(8)
                ActionButton { label: "Save"; enabled: root.canMutate && Model.parseDurationInput(entryDurationField.text) !== null && root.entryProjectId !== "" && Model.parseDateKey(root.entryDateKey); onTriggered: root.saveEntry() }
                ActionButton { label: "Cancel"; onTriggered: root.cancelEntryEditor() }
                ActionButton {
                  id: deleteEntryButton
                  visible: root.entryEditorMode === "edit"
                  enabled: root.canMutate
                  label: root.confirmingDelete ? "Delete now" : "Delete"
                  onTriggered: {
                    if (!root.confirmingDelete) root.confirmingDelete = true
                    else {
                      root.timeTracking.deleteEntry(root.editingEntryId, root.entrySnapshotToken)
                      root.confirmingDelete = false
                    }
                  }
                }
              }
              Row {
                visible: root.timeTracking && root.timeTracking.conflictPending
                spacing: Style.space(8)
                ActionButton { label: "Reload remote entry"; onTriggered: root.timeTracking.resolveConflictReload() }
                ActionButton { label: "Apply my entry"; onTriggered: root.timeTracking.resolveConflictApplyMine() }
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
    property bool selected: false
    property int cursorIndex: -1
    signal triggered()
    signal hovered()
    activeFocusOnTab: true
    Keys.onReturnPressed: action.triggered()
    Keys.onSpacePressed: action.triggered()
    implicitWidth: Math.max(Style.space(54), actionLabel.implicitWidth + Style.space(20))
    implicitHeight: Style.space(32)
    radius: Style.cornerRadius
    color: actionMouse.containsMouse || selected ? Color.accent : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.1)
    opacity: enabled ? 1 : 0.45
    Text { id: actionLabel; anchors.centerIn: parent; text: action.label; color: root.foreground; font.family: root.fontFamily }
    MouseArea {
      id: actionMouse
      anchors.fill: parent
      hoverEnabled: true
      enabled: action.enabled
      cursorShape: Qt.PointingHandCursor
      onContainsMouseChanged: {
        if (!containsMouse) return
        if (action.cursorIndex >= 0) root.keyboardCursor = action.cursorIndex
        action.hovered()
      }
      onClicked: action.triggered()
    }
  }

  Connections {
    target: root.timeTracking
    ignoreUnknownSignals: true
    function onActiveTimerChanged() { root.hydrateDrafts() }
    function onEntryDraftChanged() {
      if (!root.timeTracking || String((root.timeTracking.entryDraft || {}).mode || "") !== "") return
      root.entryEditorMode = "closed"
      root.editingEntryId = ""
      root.confirmingDelete = false
    }
    function onEntriesChanged() { root.adoptCleanEntryEditor() }
    function onDiagnosticsChanged() {
      var localToday = String((root.timeTracking.diagnostics || {}).localDate || "")
      if (localToday === "") return
      var machineToday = root.localDateKey(root.today)
      if (root.selectedDateKey === machineToday) root.selectedDateKey = localToday
      if (root.calendarCursorDateKey === machineToday) root.calendarCursorDateKey = localToday
      var local = Model.parseDateKey(localToday)
      if (local && root.viewYear === root.today.getFullYear() && root.viewMonth === root.today.getMonth() + 1) {
        root.viewYear = local.year
        root.viewMonth = local.month
      }
    }
    function onDraftTimerDurationDirtyChanged() {
      if (root.timeTracking && !root.timeTracking.draftTimerDurationDirty) root.hydrateDrafts()
    }
  }

  Component.onCompleted: Qt.callLater(function() { root.hydrateDrafts() })
}
