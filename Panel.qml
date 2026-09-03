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
  property bool cursorActive: false
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
  readonly property var projectShortcuts: timeTracking
    ? Model.searchShortcuts(Model.recentShortcutOrder(
        Model.projectShortcuts(timeTracking.projects),
        timeTracking.recentEntries,
        timeTracking.activeTimer ? timeTracking.activeTimer.projectId : "",
        timeTracking.activeTimer ? timeTracking.activeTimer.serviceId : ""
      ), projectSearch)
    : []
  readonly property var setupDiagnostics: timeTracking ? (timeTracking.diagnostics || {}) : ({})
  readonly property bool setupRequired: !timeTracking || !timeTracking.diagnosticsReady
    || setupDiagnostics.configured !== true
    || setupDiagnostics.authenticated !== true
    || setupDiagnostics.businessSelected !== true
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
  readonly property string selectedContentRole: Model.readableContentRole(
    foreground,
    Color.background,
    Style.selectedFillFor(foreground, Color.accent),
    Color.popups.background
  )
  readonly property color selectedContentColor: selectedContentRole === "background" ? Color.background : foreground
  readonly property string hoverContentRole: Model.readableContentRole(
    foreground,
    Color.background,
    Style.hoverFillFor(foreground, Color.accent),
    Color.popups.background
  )
  readonly property color hoverContentColor: hoverContentRole === "background" ? Color.background : foreground
  readonly property string consumerId: "freshbooks-panel-" + String(anchorItem)
  readonly property bool canMutate: timeTracking && !timeTracking.mutationPending && !timeTracking.outcomeUnknown && !timeTracking.conflictPending
  readonly property string pendingIntent: timeTracking ? String(timeTracking.pendingIntent || "") : ""
  readonly property bool timerActionPending: ["start", "pause", "resume", "correctDuration", "updateTimerNote", "log", "switch"].indexOf(pendingIntent) !== -1
  readonly property bool entryActionPending: ["prepareCreateEntry", "createEntry", "updateEntry", "deleteEntry"].indexOf(pendingIntent) !== -1
  readonly property string pendingMessage: {
    if (pendingIntent === "start") return "Starting timer…"
    if (pendingIntent === "pause") return "Pausing timer…"
    if (pendingIntent === "resume") return "Resuming timer…"
    if (pendingIntent === "correctDuration" || pendingIntent === "updateTimerNote") return "Saving timer…"
    if (pendingIntent === "log") return "Logging time entry…"
    if (pendingIntent === "switch") return "Switching timers…"
    if (pendingIntent === "deleteEntry") return "Deleting time entry…"
    if (entryActionPending) return "Saving time entry…"
    return ""
  }

  SystemClock {
    id: panelClock
    precision: SystemClock.Seconds
  }

  function localDateKey(date) {
    return Model.dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
  }

  function saveAuthConfiguration() {
    if (!timeTracking) return
    var secret = clientSecretField.text
    clientSecretField.text = ""
    timeTracking.configureAuth(clientIdField.text, secret, redirectUriField.text)
  }

  function openAuthorizationPage() {
    if (!timeTracking) return
    if (String(timeTracking.authorizationUrl || "") === "") {
      timeTracking.requestAuthorizationUrl()
      return
    }
    Qt.openUrlExternally(String(timeTracking.authorizationUrl))
  }

  function finishAuthentication() {
    if (!timeTracking) return
    var codeOrUrl = authorizationCodeField.text
    authorizationCodeField.text = ""
    timeTracking.completeAuthentication(codeOrUrl)
  }

  function refresh() {
    if (!timeTracking) return
    if (timeTracking.outcomeUnknown && timeTracking.retryUnknownRefresh()) return
    var cells = monthCells
    timeTracking.refreshView(tab, cells.length ? cells[0].key : "", cells.length ? cells[cells.length - 1].key : "")
  }

  function open() {
    cursorActive = false
    hydrateDrafts()
    controller.show()
    if (timeTracking) {
      timeTracking.registerVisibleConsumer(consumerId)
      refresh()
    }
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
    cursorActive = true
    var tabs = ["timer", "projects", "calendar"]
    var index = tabs.indexOf(tab)
    tab = tabs[(index + (direction > 0 ? 1 : 2)) % 3]
    keyboardCursor = 0
    calendarGridFocused = tab === "calendar"
    Qt.callLater(root.refresh)
  }

  function moveKeyboardCursor(dx, dy) {
    if (!cursorActive) {
      cursorActive = true
      return
    }
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
    if (!cursorActive) {
      cursorActive = true
      return
    }
    if (!timeTracking || timeTracking.mutationPending || timeTracking.outcomeUnknown || timeTracking.conflictPending) return
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
    if (!timeTracking || !shortcut || !canMutate) return
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
    if (seconds === null || entryProjectId === "" || !Model.parseDateKey(entryDateKey) || !timeTracking || !canMutate) return
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
    centerOnBar: false
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(460))
    contentHeight: panel.fittedContentHeight(Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: clientIdField.activeFocus || clientSecretField.activeFocus || redirectUriField.activeFocus
        || authorizationCodeField.activeFocus || noteField.activeFocus || durationField.activeFocus
        || searchField.activeFocus || root.entryEditorMode !== "closed"
      onCloseRequested: root.close()
      onMoveRequested: function(dx, dy) { if (!root.setupRequired) root.moveKeyboardCursor(dx, dy) }
      onActivateRequested: if (!root.setupRequired) root.activateKeyboardCursor()
      onDeleteRequested: if (!root.setupRequired) root.deleteKeyboardSelection()
      onTextKey: function(text) { if (!root.setupRequired && root.tab === "calendar" && (text === "g" || text === "G")) root.calendarGridFocused = true }
      onTabRequested: function(direction) {
        if (!root.setupRequired) root.switchTab(direction)
      }

      Column {
        anchors.fill: parent
        spacing: Style.space(10)

        Column {
          visible: root.setupRequired
          width: parent.width
          spacing: Style.space(10)

          Text {
            width: parent.width
            text: "Set up FreshBooks"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
          }

          Column {
            visible: !root.timeTracking || !root.timeTracking.diagnosticsReady
            width: parent.width
            spacing: Style.space(8)
            Text {
              width: parent.width
              wrapMode: Text.Wrap
              text: "freshbooks-cli with popup onboarding support is missing or incompatible. Install or update the CLI, then retry."
              color: Color.urgent
              font.family: root.fontFamily
            }
            ActionButton { label: "Retry"; enabled: root.timeTracking && !root.timeTracking.busy; onTriggered: root.timeTracking.refreshDiagnostics() }
          }

          Column {
            visible: root.timeTracking && root.timeTracking.diagnosticsReady && root.setupDiagnostics.configured !== true
            width: parent.width
            spacing: Style.space(8)
            Text {
              width: parent.width
              wrapMode: Text.Wrap
              text: "Create a FreshBooks OAuth app, then enter its credentials. The secret is sent directly to the CLI and is not saved by this plugin."
              color: root.foreground
              font.family: root.fontFamily
            }
            Text {
              width: parent.width
              wrapMode: Text.Wrap
              text: "Scopes: user:profile:read · user:projects:read · user:clients:read · user:billable_items:read · user:time_entries:read · user:time_entries:write"
              color: Qt.darker(root.foreground, 1.25)
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
            ActionButton { label: "Open FreshBooks developer hub"; onTriggered: Qt.openUrlExternally("https://my.freshbooks.com/#/developer") }
            TextField { id: clientIdField; width: parent.width; placeholderText: "Client ID" }
            TextField {
              id: clientSecretField
              width: parent.width
              placeholderText: "Client secret"
              echoMode: TextInput.Password
              inputMethodHints: Qt.ImhSensitiveData
            }
            TextField {
              id: redirectUriField
              width: parent.width
              placeholderText: "HTTPS redirect URI"
              text: "https://localhost/freshbooks/callback"
            }
            ActionButton {
              label: "Save and continue"
              enabled: root.timeTracking && !root.timeTracking.busy
                && clientIdField.text !== "" && clientSecretField.text !== "" && redirectUriField.text !== ""
              onTriggered: root.saveAuthConfiguration()
            }
          }

          Column {
            visible: root.timeTracking && root.timeTracking.diagnosticsReady
              && root.setupDiagnostics.configured === true
              && root.setupDiagnostics.authenticated !== true
            width: parent.width
            spacing: Style.space(8)
            Text {
              width: parent.width
              wrapMode: Text.Wrap
              text: "Authorize the app in FreshBooks. The localhost page may fail to load; copy its complete URL from the browser and paste it below."
              color: root.foreground
              font.family: root.fontFamily
            }
            ActionButton {
              label: String(root.timeTracking && root.timeTracking.authorizationUrl || "") === ""
                ? "Prepare authorization" : "Open FreshBooks authorization"
              enabled: root.timeTracking && !root.timeTracking.busy
              onTriggered: root.openAuthorizationPage()
            }
            TextField { id: authorizationCodeField; width: parent.width; placeholderText: "Redirect URL or authorization code" }
            ActionButton {
              label: "Finish authentication"
              enabled: root.timeTracking && !root.timeTracking.busy && authorizationCodeField.text !== ""
              onTriggered: root.finishAuthentication()
            }
          }

          Column {
            visible: root.timeTracking && root.timeTracking.diagnosticsReady
              && root.setupDiagnostics.authenticated === true
              && root.setupDiagnostics.businessSelected !== true
            width: parent.width
            spacing: Style.space(8)
            Text { text: "Choose a business"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
            Repeater {
              model: root.timeTracking ? root.timeTracking.businesses : []
              ActionButton {
                required property var modelData
                label: String(modelData.name || "FreshBooks business")
                enabled: root.timeTracking && !root.timeTracking.busy
                onTriggered: root.timeTracking.selectBusiness(modelData.id)
              }
            }
            ActionButton {
              label: "Refresh businesses"
              enabled: root.timeTracking && !root.timeTracking.busy
              onTriggered: root.timeTracking.refreshBusinesses()
            }
          }

          Text {
            visible: root.timeTracking && root.timeTracking.busy
            width: parent.width
            text: "Working…"
            color: Qt.darker(root.foreground, 1.25)
            font.family: root.fontFamily
          }
          Text {
            visible: root.timeTracking && root.timeTracking.lastError !== ""
            width: parent.width
            wrapMode: Text.Wrap
            text: root.timeTracking ? root.timeTracking.lastError : ""
            color: Color.urgent
            font.family: root.fontFamily
          }
        }

        Row {
          visible: !root.setupRequired
          width: parent.width
          spacing: Style.space(6)

          Repeater {
            model: ["timer", "projects", "calendar"]
            Button {
              id: tabButton
              required property string modelData
              width: (parent.width - Style.space(12)) / 3
              height: Style.space(34)
              active: root.tab === modelData
              bordered: true
              foreground: root.foreground
              accent: Color.accent
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              Text {
                anchors.centerIn: parent
                textFormat: Text.PlainText
                text: tabButton.modelData.toUpperCase()
                color: tabButton.hot
                  ? root.hoverContentColor
                  : (tabButton.active ? root.selectedContentColor : root.foreground)
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: tabButton.active
              }
              onClicked: {
                root.tab = modelData
                root.keyboardCursor = 0
                root.calendarGridFocused = modelData === "calendar"
                Qt.callLater(root.refresh)
              }
            }
          }
        }

        Item {
          visible: !root.setupRequired
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

            PanelHero {
              width: parent.width
              title: {
                if (!root.timeTracking || !root.timeTracking.activeTimer) return "No active timer"
                var project = root.projectById(root.timeTracking.activeTimer.projectId)
                return project
                  ? String(project.clientName || "Internal") + " · " + String(project.title || "Project")
                  : "Active timer"
              }
              meta: root.timeTracking && root.timeTracking.activeTimer
                ? String(root.timeTracking.activeTimer.note || "Untitled work")
                : "Choose a project to begin"
              detail: root.timeTracking && root.timeTracking.activeTimer
                ? Model.formatDuration(Model.elapsedSeconds(root.timeTracking.activeTimer, panelClock.date.getTime()))
                : ""
              foreground: root.foreground
              fontFamily: root.fontFamily
              iconOpacity: root.timeTracking && root.timeTracking.activeTimer ? 1 : 0.5
              iconComponent: Component {
                Text {
                  textFormat: Text.PlainText
                  text: "󰔛"
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.display
                }
              }
            }
            TextField {
              id: noteField
              width: parent.width
              enabled: root.timeTracking && root.timeTracking.activeTimer
              placeholderText: "Notes"
              onTextEdited: root.persistTimerNoteDraft()
              onEditingFinished: if (root.timeTracking && enabled && !root.timeTracking.mutationPending && text !== String(root.timeTracking.activeTimer.note || "")) root.timeTracking.updateTimerNote(text)
            }
            TextField {
              id: durationField
              width: parent.width
              enabled: root.timeTracking && root.timeTracking.activeTimer
              placeholderText: "HH:MM or HH:MM:SS"
              onTextEdited: root.persistTimerDurationDraft()
              onEditingFinished: {
                var seconds = Model.parseDurationInput(text)
                if (seconds !== null && root.timeTracking && root.timeTracking.draftTimerDurationDirty && !root.timeTracking.mutationPending) root.timeTracking.correctDuration(seconds)
                else if (root.timeTracking && root.timeTracking.activeTimer) text = Model.formatDuration(Model.elapsedSeconds(root.timeTracking.activeTimer, panelClock.date.getTime()))
              }
            }
            Text {
              visible: root.timerActionPending || (root.timeTracking && root.timeTracking.refreshing)
              text: root.timerActionPending ? root.pendingMessage : "Refreshing FreshBooks…"
              color: Qt.darker(root.foreground, 1.25)
              font.family: root.fontFamily
              horizontalAlignment: Text.AlignHCenter
              width: parent.width
            }
            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(8)
              ActionButton {
                cursorIndex: 2
                hasCursor: root.cursorActive && root.tab === "timer" && root.keyboardCursor === 2
                label: root.pendingIntent === "pause" ? "Pausing…"
                  : (root.pendingIntent === "resume" ? "Resuming…"
                    : (root.timeTracking && root.timeTracking.activeTimer && root.timeTracking.activeTimer.running ? "Pause" : "Resume"))
                iconText: root.pendingIntent === "pause" || root.pendingIntent === "resume" ? "󰑮" : ""
                iconSpinning: root.pendingIntent === "pause" || root.pendingIntent === "resume"
                enabled: root.canMutate && root.timeTracking.activeTimer
                onTriggered: {
                  if (root.timeTracking.activeTimer.running) root.timeTracking.pause()
                  else root.timeTracking.resume()
                }
              }
              ActionButton {
                cursorIndex: 3
                hasCursor: root.cursorActive && root.tab === "timer" && root.keyboardCursor === 3
                label: root.pendingIntent === "log" ? "Logging…" : "Log"
                iconText: root.pendingIntent === "log" ? "󰑮" : ""
                iconSpinning: root.pendingIntent === "log"
                enabled: root.canMutate && root.timeTracking.activeTimer
                onTriggered: root.timeTracking.logTimer()
              }
              ActionButton {
                cursorIndex: 4
                hasCursor: root.cursorActive && root.tab === "timer" && root.keyboardCursor === 4
                label: "Refresh"
                iconText: "󰑐"
                iconSpinning: root.timeTracking && root.timeTracking.refreshing
                enabled: root.timeTracking && !root.timeTracking.refreshing
                onTriggered: root.refresh()
              }
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
            Text {
              id: projectStatus
              visible: root.timerActionPending || (root.timeTracking && root.timeTracking.refreshing)
              width: parent.width
              text: root.timerActionPending ? root.pendingMessage : "Refreshing FreshBooks…"
              color: Qt.darker(root.foreground, 1.25)
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              horizontalAlignment: Text.AlignHCenter
            }
            Flickable {
              width: parent.width
              height: parent.height - searchField.height
                - (projectStatus.visible ? projectStatus.implicitHeight + Style.space(8) : 0)
                - Style.space(8)
              contentHeight: projectColumn.implicitHeight
              clip: true
              Column {
                id: projectColumn
                width: parent.width
                spacing: Style.space(4)
                Repeater {
                  model: root.projectShortcuts
                  CursorSurface {
                    id: projectRow
                    required property var modelData
                    required property int index
                    readonly property color contentColor: hasCursor
                      ? root.hoverContentColor
                      : (current ? root.selectedContentColor : root.foreground)
                    width: projectColumn.width
                    height: Style.space(58)
                    hasCursor: root.cursorActive && root.tab === "projects" && root.keyboardCursor === index
                    current: root.timeTracking && root.timeTracking.activeTimer
                      && String(root.timeTracking.activeTimer.projectId) === String(modelData.projectId)
                      && String(root.timeTracking.activeTimer.serviceId) === String(modelData.serviceId)
                    foreground: root.foreground
                    accent: Color.accent
                    MouseArea {
                      id: projectMouse
                      anchors.left: parent.left
                      anchors.top: parent.top
                      anchors.bottom: parent.bottom
                      anchors.right: projectAction.left
                      hoverEnabled: true
                      enabled: root.canMutate
                      cursorShape: Qt.PointingHandCursor
                      onContainsMouseChanged: {
                        if (!containsMouse) return
                        root.cursorActive = true
                        root.keyboardCursor = index
                      }
                      onClicked: root.startShortcut(modelData)
                    }
                    Column {
                      anchors.left: parent.left
                      anchors.right: projectAction.left
                      anchors.leftMargin: Style.space(10)
                      anchors.rightMargin: Style.space(10)
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(2)
                      Text {
                        id: projectTitleLabel
                        width: parent.width
                        text: String(modelData.project.title || modelData.project.name || "Project")
                        elide: Text.ElideRight
                        color: projectRow.contentColor
                        font.family: root.fontFamily
                      }
                      Text {
                        id: projectMetaLabel
                        width: parent.width
                        text: String(modelData.project.clientName || "Internal")
                          + (modelData.serviceName ? " · " + modelData.serviceName : "")
                        elide: Text.ElideRight
                        color: projectRow.current || projectRow.hasCursor
                          ? projectRow.contentColor
                          : Qt.darker(root.foreground, 1.25)
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.bodySmall
                      }
                    }
                    PanelActionButton {
                      id: projectAction
                      readonly property bool pending: root.timerActionPending
                        && String((root.timeTracking.pendingPayload || {}).projectId || "") === String(modelData.projectId)
                        && String((root.timeTracking.pendingPayload || {}).serviceId || "") === String(modelData.serviceId)
                      anchors.right: parent.right
                      anchors.rightMargin: Style.space(6)
                      anchors.verticalCenter: parent.verticalCenter
                      iconText: pending ? "󰑮"
                        : (root.timeTracking && root.timeTracking.activeTimer
                          && String(root.timeTracking.activeTimer.projectId) === String(modelData.projectId)
                          && String(root.timeTracking.activeTimer.serviceId) === String(modelData.serviceId)
                          && root.timeTracking.activeTimer.running ? "󰏤" : "󰐊")
                      tooltipText: pending ? root.pendingMessage : (iconText === "󰏤" ? "Pause timer" : "Start timer")
                      foreground: projectRow.contentColor
                      hoverColor: projectRow.contentColor
                      fontFamily: root.fontFamily
                      fontSize: Style.font.title
                      enabled: root.canMutate
                      rotation: pending ? 0 : 0
                      RotationAnimation on rotation {
                        from: 0
                        to: 360
                        duration: 900
                        loops: Animation.Infinite
                        running: projectAction.pending
                      }
                      onHovered: function(h) {
                        if (!h) return
                        root.cursorActive = true
                        root.keyboardCursor = index
                      }
                      onClicked: root.startShortcut(modelData)
                    }
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
              visible: root.pendingMessage !== "" || (root.timeTracking && (root.timeTracking.activeTimer || root.timeTracking.refreshing))
              text: {
                if (root.pendingMessage !== "") return root.pendingMessage
                var message = root.timeTracking && root.timeTracking.activeTimer
                  ? "Active timer · " + Model.formatDuration(Model.elapsedSeconds(root.timeTracking.activeTimer, panelClock.date.getTime())) + " · not included in totals"
                  : ""
                if (root.timeTracking && root.timeTracking.refreshing)
                  message += (message === "" ? "" : " · ") + "Refreshing FreshBooks…"
                return message
              }
              color: Color.accent
              font.family: root.fontFamily
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
            }
            Item {
              width: parent.width
              height: Math.max(monthLabel.implicitHeight, previousMonthButton.implicitHeight, nextMonthButton.implicitHeight)
              PanelActionButton {
                id: previousMonthButton
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰅁"
                tooltipText: "Previous month"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.moveMonth(-1)
              }
              Text {
                id: monthLabel
                anchors.centerIn: parent
                text: Qt.formatDate(new Date(root.viewYear, root.viewMonth - 1, 1), "MMMM yyyy")
                color: root.foreground
                font.family: root.fontFamily
                font.bold: true
              }
              PanelActionButton {
                id: nextMonthButton
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰅂"
                tooltipText: "Next month"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.moveMonth(1)
              }
            }
            Grid {
              id: calendarGrid
              width: parent.width
              columns: 7
              spacing: Style.space(3)
              Repeater {
                model: root.monthCells
                CursorSurface {
                  id: dayCell
                  required property var modelData
                  readonly property color contentColor: hasCursor
                    ? root.hoverContentColor
                    : (current ? root.selectedContentColor : root.foreground)
                  width: (calendarGrid.width - calendarGrid.spacing * 6) / 7
                  height: Style.space(45)
                  hasCursor: root.cursorActive && root.calendarGridFocused && root.calendarCursorDateKey === modelData.key
                  current: root.selectedDateKey === modelData.key
                  bordered: root.todayDateKey === modelData.key
                  foreground: root.foreground
                  accent: Color.accent
                  Text { anchors.horizontalCenter: parent.horizontalCenter; anchors.top: parent.top; anchors.topMargin: 4; text: modelData.day; color: dayCell.current || dayCell.hasCursor ? dayCell.contentColor : (modelData.inMonth ? root.foreground : Qt.darker(root.foreground, 1.7)); font.family: root.fontFamily }
                  Text { anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 3; text: root.timeTracking ? Model.formatHoursMinutes((root.timeTracking.state.totals.byDay || {})[modelData.key] || 0) : ""; color: dayCell.contentColor; opacity: text === "00:00" ? 0 : 0.7; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                  Rectangle { visible: root.timeTracking && Model.entriesForDay(root.timeTracking.entries, modelData.key).length > 0; width: 4; height: 4; radius: 2; color: dayCell.contentColor; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 4 }
                  MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onContainsMouseChanged: {
                      if (!containsMouse) return
                      root.cursorActive = true
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
              ActionButton { id: addEntryButton; cursorIndex: 0; hasCursor: root.cursorActive && root.tab === "calendar" && !root.calendarGridFocused && root.keyboardCursor === 0; label: "+ Entry"; calendarListTarget: true; onTriggered: root.beginAddEntry() }
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
                  CursorSurface {
                    id: entryRow
                    required property var modelData
                    required property int index
                    readonly property color contentColor: hasCursor ? root.hoverContentColor : root.foreground
                    width: entryColumn.width
                    height: Style.space(38)
                    hasCursor: root.cursorActive && !root.calendarGridFocused && root.keyboardCursor === index + 1
                    foreground: root.foreground
                    accent: Color.accent
                    Text { anchors.left: parent.left; anchors.leftMargin: Style.space(10); anchors.verticalCenter: parent.verticalCenter; width: parent.width - Style.space(110); text: String(modelData.note || "No notes"); color: entryRow.contentColor; elide: Text.ElideRight; font.family: root.fontFamily }
                    Text { anchors.right: parent.right; anchors.rightMargin: Style.space(10); anchors.verticalCenter: parent.verticalCenter; text: Model.formatDuration(modelData.durationSeconds !== undefined ? modelData.durationSeconds : modelData.duration || 0); color: entryRow.contentColor; font.family: root.fontFamily }
                    MouseArea {
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onContainsMouseChanged: {
                        if (!containsMouse) return
                        root.cursorActive = true
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
              PanelSectionHeader { text: "PROJECT AND SERVICE"; foreground: root.foreground; fontFamily: root.fontFamily }
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
                    CursorSurface {
                      id: entryProjectChoice
                      required property var modelData
                      property bool pointerHot: false
                      readonly property color contentColor: hasCursor
                        ? root.hoverContentColor
                        : (current ? root.selectedContentColor : root.foreground)
                      width: entryProjectColumn.width
                      height: Style.space(30)
                      activeFocusOnTab: true
                      hasCursor: activeFocus || pointerHot
                      current: String(root.entryProjectId) === String(modelData.projectId) && String(root.entryServiceId) === String(modelData.serviceId)
                      bordered: true
                      foreground: root.foreground
                      accent: Color.accent
                      Text { anchors.left: parent.left; anchors.leftMargin: Style.space(10); anchors.right: parent.right; anchors.rightMargin: Style.space(10); anchors.verticalCenter: parent.verticalCenter; elide: Text.ElideRight; text: String(modelData.project.clientName || "Internal") + " · " + String(modelData.project.title || "Project") + (modelData.serviceName ? " · " + modelData.serviceName : ""); color: entryProjectChoice.contentColor; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
                      MouseArea {
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onContainsMouseChanged: entryProjectChoice.pointerHot = containsMouse
                        onClicked: {
                          root.entryProjectId = String(modelData.projectId)
                          root.entryServiceId = String(modelData.serviceId)
                          root.persistEntryDraft(true)
                        }
                      }
                      Keys.onReturnPressed: { root.entryProjectId = String(modelData.projectId); root.entryServiceId = String(modelData.serviceId); root.persistEntryDraft(true) }
                      Keys.onSpacePressed: { root.entryProjectId = String(modelData.projectId); root.entryServiceId = String(modelData.serviceId); root.persistEntryDraft(true) }
                    }
                  }
                }
              }
              Row {
                spacing: Style.space(8)
                ActionButton {
                  label: root.entryActionPending && root.pendingIntent !== "deleteEntry" ? "Saving…" : "Save"
                  iconText: root.entryActionPending && root.pendingIntent !== "deleteEntry" ? "󰑮" : ""
                  iconSpinning: root.entryActionPending && root.pendingIntent !== "deleteEntry"
                  enabled: root.canMutate && Model.parseDurationInput(entryDurationField.text) !== null && root.entryProjectId !== "" && Model.parseDateKey(root.entryDateKey)
                  onTriggered: root.saveEntry()
                }
                ActionButton { label: "Cancel"; onTriggered: root.cancelEntryEditor() }
                ActionButton {
                  id: deleteEntryButton
                  visible: root.entryEditorMode === "edit"
                  enabled: root.canMutate
                  label: root.pendingIntent === "deleteEntry" ? "Deleting…" : (root.confirmingDelete ? "Delete now" : "Delete")
                  iconText: root.pendingIntent === "deleteEntry" ? "󰑮" : ""
                  iconSpinning: root.pendingIntent === "deleteEntry"
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

  component ActionButton: Button {
    id: action
    property string label: ""
    property int cursorIndex: -1
    property bool calendarListTarget: false
    signal triggered()

    text: label
    bordered: true
    focusable: true
    foreground: root.foreground
    accent: Color.accent
    fontFamily: root.fontFamily
    fontSize: Style.font.body
    opacity: enabled ? 1 : 0.45

    onHovered: function(h) {
      if (!h) return
      root.cursorActive = true
      if (action.cursorIndex >= 0) root.keyboardCursor = action.cursorIndex
      if (action.calendarListTarget) root.calendarGridFocused = false
    }
    onClicked: action.triggered()
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
