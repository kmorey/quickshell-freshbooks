import QtQuick
import QtQuick.Controls
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
  readonly property var serviceView: timeTracking && timeTracking.view ? timeTracking.view : ({ records: ({}), actions: ({}), operations: [], conflicts: [], errors: [] })
  readonly property var records: serviceView.records || ({})
  readonly property var projects: Array.isArray(serviceView.projects) ? serviceView.projects : []
  readonly property var recordList: {
    var values = []
    var scopes = Object.keys(records)
    for (var i = 0; i < scopes.length; i++) {
      var record = records[scopes[i]]
      if (record && record.exists !== false) values.push(record)
    }
    return values
  }
  readonly property var timers: recordList.filter(function(record) { return record.kind === "active-timer" })
  readonly property var entries: recordList.filter(function(record) { return record.kind === "time-entry" })
  readonly property var activeTimer: Model.selectedTimer(timers, timeTracking ? timeTracking.selectedTimerId : "")
  readonly property string timerMode: Model.timerMode(timers)
  readonly property var conflicts: Array.isArray(serviceView.conflicts) ? serviceView.conflicts : []
  readonly property var totals: Model.aggregateEntries(entries)
  readonly property var operations: Array.isArray(serviceView.operations) ? serviceView.operations : []
  readonly property var errors: Array.isArray(serviceView.errors) ? serviceView.errors : []
  readonly property string todayDateKey: timeTracking && String((timeTracking.diagnostics || {}).localDate || "") !== ""
    ? String(timeTracking.diagnostics.localDate) : localDateKey(today)
  readonly property var monthCells: Model.calendarMonth(viewYear, viewMonth)
  readonly property var dayEntries: Model.entriesForDay(entries, selectedDateKey)
  readonly property var orderedProjects: Model.recentProjectOrder(projects, entries, activeTimer ? activeTimer.projectId : "")
  readonly property var projectShortcuts: Model.searchShortcuts(Model.recentShortcutOrder(
    Model.projectShortcuts(projects),
    entries,
    activeTimer ? activeTimer.projectId : "",
    activeTimer ? activeTimer.serviceId : ""
  ), projectSearch)
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
  property string entryOriginalProjectId: ""
  property string entryOriginalServiceId: ""
  property string entryOriginalNote: ""
  property int entryOriginalDurationSeconds: 0
  property bool entryNoteDirty: false
  property bool entryDurationDirty: false
  property bool entryDateDirty: false
  property bool entryAssignmentDirty: false
  readonly property bool entryHasDirtyFields: entryNoteDirty || entryDurationDirty || entryDateDirty || entryAssignmentDirty
  property bool confirmingDelete: false
  onEntryEditorModeChanged: {
    if (entryEditorMode === "closed") Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }
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
  readonly property bool timerActionPending: activeTimer && recordStatus(recordScope(activeTimer)) === "settling"
  readonly property bool entryActionPending: editingEntryId !== "" && recordStatus("time-entry:" + editingEntryId) === "settling"
  readonly property string pendingMessage: timerActionPending ? "Settling timer…" : (entryActionPending ? "Settling time entry…" : "")

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
    var cells = monthCells
    timeTracking.refreshView(tab, cells.length ? cells[0].key : "", cells.length ? cells[cells.length - 1].key : "")
  }

  function open() {
    cursorActive = false
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
    var count = tab === "timer" ? 5 : (tab === "projects" ? projectShortcuts.length : dayEntries.length * 2 + 1)
    keyboardCursor = Math.max(0, Math.min(count - 1, keyboardCursor + dy))
    if (tab === "calendar" && keyboardCursor === 0 && dy < 0) calendarGridFocused = true
  }

  function activateKeyboardCursor() {
    if (!cursorActive) {
      cursorActive = true
      return
    }
    if (!timeTracking) return
    if (tab === "timer") {
      if (keyboardCursor === 0) noteField.forceActiveFocus()
      else if (keyboardCursor === 1) durationField.forceActiveFocus()
      else if (keyboardCursor === 2 && activeTimer && canMutateRecord(activeTimer)) timerRunning(activeTimer) ? timeTracking.pause() : timeTracking.resume()
      else if (keyboardCursor === 3 && activeTimer && canMutateRecord(activeTimer)) timeTracking.log()
      else if (keyboardCursor === 4) refresh()
    } else if (tab === "projects" && projectShortcuts.length) {
      startShortcut(projectShortcuts[Math.min(keyboardCursor, projectShortcuts.length - 1)])
    } else if (tab === "calendar") {
      if (calendarGridFocused) {
        selectedDateKey = calendarCursorDateKey
        calendarGridFocused = false
        keyboardCursor = 0
      } else if (keyboardCursor === 0) beginAddEntry()
      else if (dayEntries.length) {
        var entry = dayEntries[Math.min(Math.floor((keyboardCursor - 1) / 2), dayEntries.length - 1)]
        if (keyboardCursor % 2 === 0) resumeEntry(entry)
        else beginEditEntry(entry)
      }
    }
  }

  function deleteKeyboardSelection() {
    if (tab !== "calendar") return
    if (entryEditorMode === "closed" && !calendarGridFocused && keyboardCursor > 0 && dayEntries.length) {
      beginEditEntry(dayEntries[Math.min(Math.floor((keyboardCursor - 1) / 2), dayEntries.length - 1)])
    }
    if (entryEditorMode !== "edit") return
    confirmingDelete = true
    Qt.callLater(function() { deleteEntryButton.forceActiveFocus() })
  }

  function cancelEntryEditor() {
    if (confirmingDelete) { confirmingDelete = false; return }
    entryEditorMode = "closed"
    editingEntryId = ""
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

  function serviceName(project, serviceId) {
    if (!project || !Array.isArray(project.services)) return ""
    for (var i = 0; i < project.services.length; i++)
      if (String(project.services[i].id) === String(serviceId)) return String(project.services[i].name || "")
    return ""
  }

  function recordScope(record) {
    var scopes = Object.keys(records)
    for (var i = 0; record && i < scopes.length; i++)
      if (records[scopes[i]] === record) return scopes[i]
    return record ? String(record.kind || "") + ":" + String(record.id || "") : ""
  }

  function timerRunning(timer) {
    return !!timer && timer.state === "running"
  }

  function canMutateScope(scope) {
    var action = serviceView.actions && serviceView.actions[String(scope || "")]
    return !action || action.canMutate !== false
  }

  function canMutateRecord(record) {
    return !!record && canMutateScope(recordScope(record))
  }

  function recordStatus(scope) {
    var wanted = String(scope || "")
    for (var i = conflicts.length - 1; i >= 0; i--)
      if (String(conflicts[i].scope || "") === wanted) return "conflict"
    for (var j = operations.length - 1; j >= 0; j--) {
      var operation = operations[j]
      if (String(operation.scope || "") !== wanted) continue
      if (operation.state === "unknown") return "unknown"
      if (["prepared", "in-flight", "rebasing"].indexOf(operation.state) !== -1) return "settling"
      if (operation.state === "not-applied") return "error"
    }
    for (var k = errors.length - 1; k >= 0; k--)
      if (String(errors[k].scope || "") === wanted) return "error"
    return ""
  }

  function recordStatusLabel(record) {
    var status = recordStatus(recordScope(record))
    if (status === "settling") return "Settling…"
    if (status === "unknown") return "Outcome unknown — checking FreshBooks"
    if (status === "conflict") return "Needs field choices"
    if (status === "error") return "Could not save"
    return ""
  }

  function conflictValue(value) {
    if (value === null || value === undefined) return "none"
    return typeof value === "object" ? JSON.stringify(value) : String(value)
  }


  function startProject(project) {
    if (!timeTracking) return
    var serviceId = projectServiceId(project)
    if (activeTimer && canMutateRecord(activeTimer)) timeTracking.switchTimer(project.id, serviceId)
    else if (!activeTimer) timeTracking.start(project.id, serviceId, "")
  }

  function startShortcut(shortcut) {
    if (!timeTracking || !shortcut) return
    var active = activeTimer
    if (active && !canMutateRecord(active)) return
    var sameShortcut = active && String(active.projectId) === String(shortcut.projectId)
      && String(active.serviceId) === String(shortcut.serviceId)
    if (sameShortcut) {
      if (timerRunning(active)) timeTracking.pause()
      else timeTracking.resume()
    } else if (active) timeTracking.switchTimer(shortcut.projectId, shortcut.serviceId)
    else timeTracking.start(shortcut.projectId, shortcut.serviceId, "")
  }

  function entryMatchesTimer(entry) {
    var timer = activeTimer
    return !!(entry && timer
      && String(entry.projectId) === String(timer.projectId)
      && String(entry.serviceId || "") === String(timer.serviceId || "")
      && String(entry.note || "") === String(timer.note || ""))
  }

  function resumeEntry(entry) {
    if (!entry || (activeTimer && !canMutateRecord(activeTimer))) return
    if (entryMatchesTimer(entry)) {
      if (timerRunning(activeTimer)) timeTracking.pause()
      else timeTracking.resume()
    } else if (activeTimer) timeTracking.switchTimer(entry.projectId, entry.serviceId, entry.note)
    else timeTracking.start(entry.projectId, entry.serviceId, entry.note)
  }

  function projectById(projectId) {
    for (var i = 0; i < projects.length; i++)
      if (String(projects[i].id) === String(projectId)) return projects[i]
    return null
  }

  function resetEntryDirtyGroups() {
    entryNoteDirty = false
    entryDurationDirty = false
    entryDateDirty = false
    entryAssignmentDirty = false
  }

  function beginAddEntry() {
    var project = orderedProjects.length ? orderedProjects[0] : null
    entryEditorMode = "create"
    editingEntryId = ""
    entryProjectId = project ? String(project.id) : ""
    entryServiceId = projectServiceId(project) === null ? "" : String(projectServiceId(project))
    entryDateKey = selectedDateKey
    entryOriginalDateKey = ""
    entryOriginalProjectId = entryProjectId
    entryOriginalServiceId = entryServiceId
    entryOriginalNote = ""
    entryOriginalDurationSeconds = 0
    confirmingDelete = false
    entryDateField.text = entryDateKey
    entryNoteField.text = ""
    entryDurationField.text = "00:00"
    resetEntryDirtyGroups()
  }

  function beginEditEntry(entry) {
    entryEditorMode = "edit"
    editingEntryId = String(entry.id)
    entryProjectId = String(entry.projectId === null ? "" : entry.projectId)
    entryServiceId = String(entry.serviceId === null ? "" : entry.serviceId)
    entryDateKey = String(entry.localDate || selectedDateKey)
    entryOriginalDateKey = entryDateKey
    entryOriginalProjectId = entryProjectId
    entryOriginalServiceId = entryServiceId
    entryOriginalNote = String(entry.note || "")
    entryOriginalDurationSeconds = Number(entry.durationSeconds || 0)
    confirmingDelete = false
    entryDateField.text = entryDateKey
    entryNoteField.text = String(entry.note || "")
    entryDurationField.text = Model.formatDuration(entry.durationSeconds || 0)
    resetEntryDirtyGroups()
  }

  function saveEntry() {
    var seconds = Model.parseDurationInput(entryDurationField.text)
    var scope = editingEntryId === "" ? "" : "time-entry:" + editingEntryId
    if (seconds === null || entryProjectId === "" || !Model.parseDateKey(entryDateKey)
        || !timeTracking || (scope !== "" && !canMutateScope(scope))) return
    var draft = {
      durationSeconds: seconds,
      projectId: entryProjectId,
      serviceId: entryServiceId,
      note: entryNoteField.text,
      localDate: entryDateKey
    }
    if (entryEditorMode === "edit") {
      entryNoteDirty = draft.note !== entryOriginalNote
      entryDurationDirty = draft.durationSeconds !== entryOriginalDurationSeconds
      entryDateDirty = draft.localDate !== entryOriginalDateKey
      entryAssignmentDirty = String(draft.projectId) !== entryOriginalProjectId
        || String(draft.serviceId) !== entryOriginalServiceId
    }
    if (entryEditorMode === "edit" && !entryHasDirtyFields) return
    var fields = entryEditorMode === "create" ? draft : Model.entryUpdateFields(draft, {
      note: entryNoteDirty,
      duration: entryDurationDirty,
      date: entryDateDirty,
      assignment: entryAssignmentDirty
    })
    var accepted = entryEditorMode === "create"
      ? timeTracking.createEntry(fields)
      : timeTracking.updateEntry(editingEntryId, fields)
    if (accepted) cancelEntryEditor()
  }

  function deleteEditedEntry() {
    if (!timeTracking || editingEntryId === "" || !canMutateScope("time-entry:" + editingEntryId)) return
    if (timeTracking.deleteEntry(editingEntryId)) {
      confirmingDelete = false
      cancelEntryEditor()
    }
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
      Shortcut {
        sequence: "Escape"
        context: Qt.WindowShortcut
        enabled: root.opened
        onActivated: root.close()
      }
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

        Column {
          id: conflictChoices
          width: parent.width
          visible: !root.setupRequired && root.conflicts.length > 0
              spacing: Style.space(8)
              Repeater {
                model: root.conflicts
                Column {
                  id: conflictItem
                  required property var modelData
                  width: parent.width
                  spacing: Style.space(6)
                  Text { text: conflictItem.modelData.deletion ? "FreshBooks deleted this record" : "Choose each conflicting field"; color: Color.urgent; font.family: root.fontFamily; font.bold: true }
                  Repeater {
                    model: conflictItem.modelData.groups || []
                    Flow {
                      required property var modelData
                      width: parent.width
                      spacing: Style.space(6)
                      Text { text: String(modelData.group || "Field"); color: root.foreground; font.family: root.fontFamily }
                      Text {
                        width: parent.width
                        wrapMode: Text.Wrap
                        text: "Mine: " + root.conflictValue(modelData.mine)
                          + " · FreshBooks: " + root.conflictValue(modelData.freshbooks)
                        color: root.foreground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.bodySmall
                      }
                      ActionButton { label: "Mine"; onTriggered: root.timeTracking.chooseMine(conflictItem.modelData.operationId, modelData.group) }
                      ActionButton { label: "FreshBooks"; onTriggered: root.timeTracking.chooseFreshBooks(conflictItem.modelData.operationId, modelData.group) }
                    }
                  }
                  Flow {
                    visible: conflictItem.modelData.deletion === true
                    width: parent.width
                    spacing: Style.space(6)
                    ActionButton { label: "Restore as new"; onTriggered: root.timeTracking.restoreAsNew(conflictItem.modelData.operationId) }
                    ActionButton { label: "Discard local"; onTriggered: root.timeTracking.discardLocal(conflictItem.modelData.operationId) }
                  }
                }
              }
            }
        Item {
          visible: !root.setupRequired
          width: parent.width
          height: parent.height - Style.space(44) - (conflictChoices.visible ? conflictChoices.implicitHeight + Style.space(8) : 0)

          Column {
            visible: root.tab === "timer"
            anchors.fill: parent
            spacing: Style.space(12)

            Column {
              width: parent.width
              visible: root.timerMode === "multiple" && !root.activeTimer
              spacing: Style.space(4)
              Text { text: "Choose the FreshBooks timer to manage"; color: Color.urgent; font.family: root.fontFamily; font.bold: true }
              Repeater {
                model: root.timers
                ActionButton {
                  required property var modelData
                  label: Model.formatDuration(Model.projectElapsedSeconds(modelData, panelClock.date.getTime())) + "  " + String(modelData.note || "Untitled timer")
                  onTriggered: root.timeTracking.selectTimer(modelData.id)
                }
              }
            }

            Item {
              id: timerHeader
              width: parent.width
              implicitHeight: timerHero.implicitHeight
              readonly property bool refreshing: root.timeTracking && root.timeTracking.refreshing
              readonly property bool refreshCursor: root.cursorActive && root.tab === "timer" && root.keyboardCursor === 4
              function focusRefresh() { root.cursorActive = true; root.keyboardCursor = 4 }
              function refreshNow() { root.refresh() }

              PanelHero {
                id: timerHero
                width: parent.width
                title: {
                  if (!root.activeTimer) return "No active timer"
                  var project = root.projectById(root.activeTimer.projectId)
                  return project ? String(project.title || "Project") : "Active timer"
                }
                meta: {
                  if (!root.activeTimer) return "Choose a project to begin"
                  var project = root.projectById(root.activeTimer.projectId)
                  if (!project) return "FreshBooks timer"
                  var client = String(project.clientName || "Internal")
                  var service = root.serviceName(project, root.activeTimer.serviceId)
                  return client + (service === "" ? "" : " · " + service)
                }
                foreground: root.foreground
                fontFamily: root.fontFamily
                iconOpacity: root.activeTimer ? 1 : 0.5
                iconComponent: Component {
                  Text {
                    textFormat: Text.PlainText
                    text: "󰔛"
                    color: timerHero.foreground
                    font.family: timerHero.fontFamily
                    font.pixelSize: Style.font.display
                  }
                }
                trailingControl: Component {
                  Button {
                    iconText: "󰑐"
                    tooltipText: "Refresh FreshBooks"
                    iconSpinning: timerHeader.refreshing
                    enabled: !timerHeader.refreshing
                    hasCursor: timerHeader.refreshCursor
                    focusable: true
                    bordered: true
                    foreground: timerHero.foreground
                    accent: Color.accent
                    fontFamily: timerHero.fontFamily
                    horizontalPadding: Style.spacing.controlGap
                    verticalPadding: Style.spacing.labelGap
                    onHovered: function(h) { if (h) timerHeader.focusRefresh() }
                    onClicked: timerHeader.refreshNow()
                  }
                }
              }
            }
            TextField {
              id: noteField
              width: parent.width
              enabled: root.activeTimer && root.canMutateRecord(root.activeTimer)
              placeholderText: "Notes"
              onActiveFocusChanged: if (activeFocus && root.activeTimer) text = String(root.activeTimer.note || "")
              onEditingFinished: {
                if (!root.activeTimer || !root.canMutateRecord(root.activeTimer)) return
                if (text !== String(root.activeTimer.note || "") && root.timeTracking.updateNote(text)) focus = false
              }
              Binding { target: noteField; property: "text"; when: !noteField.activeFocus; value: root.activeTimer ? String(root.activeTimer.note || "") : "" }
            }
            TextField {
              id: durationField
              width: parent.width
              enabled: root.activeTimer && root.canMutateRecord(root.activeTimer)
              placeholderText: "HH:MM or HH:MM:SS"
              onEditingFinished: {
                var seconds = Model.parseDurationInput(text)
                if (seconds !== null && root.activeTimer && root.canMutateRecord(root.activeTimer)
                    && root.timeTracking.correctDuration(seconds)) focus = false
              }
              Binding { target: durationField; property: "text"; when: !durationField.activeFocus; value: root.activeTimer ? Model.formatDuration(Model.projectElapsedSeconds(root.activeTimer, panelClock.date.getTime())) : "" }
            }
            Text {
              visible: text !== ""
              text: root.activeTimer ? root.recordStatusLabel(root.activeTimer) : ""
              color: text === "Could not save" || text === "Needs field choices" ? Color.urgent : Qt.darker(root.foreground, 1.25)
              font.family: root.fontFamily
              horizontalAlignment: Text.AlignHCenter
              width: parent.width
            }
            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(8)
              ActionButton {
                id: timerToggleButton
                cursorIndex: 2
                hasCursor: root.cursorActive && root.tab === "timer" && root.keyboardCursor === 2
                label: ""
                tooltipText: root.timerActionPending ? "Settling timer"
                  : (root.timerRunning(root.activeTimer) ? "Pause timer" : "Resume timer")
                active: true
                implicitWidth: Style.space(58)
                implicitHeight: Style.space(38)
                opacity: enabled || root.timerActionPending ? 1 : 0.45
                enabled: root.activeTimer && root.canMutateRecord(root.activeTimer)
                onTriggered: {
                  if (root.timerRunning(root.activeTimer)) root.timeTracking.pause()
                  else root.timeTracking.resume()
                }
                Text {
                  id: timerToggleGlyph
                  anchors.centerIn: parent
                  textFormat: Text.PlainText
                  text: root.timerActionPending ? "󰦖"
                    : (root.timerRunning(root.activeTimer) ? "󰏤" : "󰐊")
                  color: timerToggleButton.hot ? root.hoverContentColor : root.selectedContentColor
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  rotation: root.timerActionPending ? 0 : 0
                  RotationAnimation on rotation {
                    from: 0
                    to: 360
                    duration: 900
                    loops: Animation.Infinite
                    running: root.timerActionPending
                  }
                }
              }
              ActionButton {
                id: timerSaveButton
                cursorIndex: 3
                hasCursor: root.cursorActive && root.tab === "timer" && root.keyboardCursor === 3
                label: root.timerActionPending ? "" : "Save"
                iconText: root.timerActionPending ? "󰦖" : ""
                iconSpinning: root.timerActionPending
                tooltipText: root.timerActionPending ? "Settling timer" : "Save timer as time entry"
                implicitWidth: timerToggleButton.implicitWidth
                implicitHeight: timerToggleButton.implicitHeight
                enabled: root.activeTimer && root.canMutateRecord(root.activeTimer)
                onTriggered: root.timeTracking.log()
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
          }

          Column {
            visible: root.tab === "projects"
            anchors.fill: parent
            spacing: Style.space(8)
            TextField { id: searchField; width: parent.width; placeholderText: "Search projects or clients"; text: root.projectSearch; onTextChanged: root.projectSearch = text }
            Text {
              id: projectStatus
              visible: root.timerActionPending
              width: parent.width
              text: root.pendingMessage
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
                    current: root.activeTimer
                      && String(root.activeTimer.projectId) === String(modelData.projectId)
                      && String(root.activeTimer.serviceId) === String(modelData.serviceId)
                    foreground: root.foreground
                    accent: Color.accent
                    MouseArea {
                      id: projectMouse
                      anchors.left: parent.left
                      anchors.top: parent.top
                      anchors.bottom: parent.bottom
                      anchors.right: projectAction.left
                      hoverEnabled: true
                      enabled: !root.activeTimer || root.canMutateRecord(root.activeTimer)
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
                      anchors.right: parent.right
                      anchors.rightMargin: Style.space(6)
                      anchors.verticalCenter: parent.verticalCenter
                      iconText: pending ? "󰦖"
                        : (root.activeTimer
                          && String(root.activeTimer.projectId) === String(modelData.projectId)
                          && String(root.activeTimer.serviceId) === String(modelData.serviceId)
                          && root.timerRunning(root.activeTimer) ? "󰏤" : "󰐊")
                      tooltipText: pending ? root.pendingMessage : (iconText === "󰏤" ? "Pause timer" : "Start timer")
                      foreground: projectRow.contentColor
                      hoverColor: projectRow.contentColor
                      fontFamily: root.fontFamily
                      fontSize: Style.font.title
                      enabled: !root.activeTimer || root.canMutateRecord(root.activeTimer)
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

          Flickable {
            id: calendarViewport
            visible: root.tab === "calendar"
            anchors.fill: parent
            contentWidth: width
            contentHeight: calendarContent.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            flickableDirection: Flickable.VerticalFlick
            interactive: contentHeight > height
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            Column {
              id: calendarContent
              width: calendarViewport.width
              spacing: Style.space(8)
              Text {
              width: parent.width
              visible: root.pendingMessage !== "" || root.activeTimer
              text: {
                if (root.pendingMessage !== "") return root.pendingMessage
                return root.activeTimer
                  ? "Active timer · " + Model.formatDuration(Model.projectElapsedSeconds(root.activeTimer, panelClock.date.getTime())) + " · not included in totals"
                  : ""
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
                  Text { anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 3; text: Model.formatHoursMinutes((root.totals.byDay || {})[modelData.key] || 0); color: dayCell.contentColor; opacity: text === "00:00" ? 0 : 0.7; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                  Rectangle { visible: Model.entriesForDay(root.entries, modelData.key).length > 0; width: 4; height: 4; radius: 2; color: dayCell.contentColor; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 4 }
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
              Text { width: parent.width - addEntryButton.width; anchors.verticalCenter: parent.verticalCenter; text: root.selectedDateKey + " · " + Model.formatDuration(Model.reportingWeekTotal(root.entries, root.selectedDateKey)) + " this week"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
              ActionButton { id: addEntryButton; cursorIndex: 0; hasCursor: root.cursorActive && root.tab === "calendar" && !root.calendarGridFocused && root.keyboardCursor === 0; label: "+ Entry"; calendarListTarget: true; onTriggered: root.beginAddEntry() }
            }
            Column {
              width: parent.width
              id: entryColumn
              spacing: Style.space(4)
              Repeater {
                model: root.dayEntries
                CursorSurface {
                  id: entryRow
                  required property var modelData
                  required property int index
                  readonly property color contentColor: hasCursor ? root.hoverContentColor : root.foreground
                  readonly property var project: root.projectById(modelData.projectId)
                  readonly property bool running: root.entryMatchesTimer(modelData) && root.timerRunning(root.activeTimer)
                  width: entryColumn.width
                  height: Math.max(entryDetails.implicitHeight + Style.space(16), resumeEntryButton.height)
                  hasCursor: root.cursorActive && !root.calendarGridFocused && root.keyboardCursor === index * 2 + 1
                  foreground: root.foreground
                  accent: Color.accent
                  Column {
                    id: entryDetails
                    anchors.left: parent.left
                    anchors.leftMargin: Style.space(10)
                    anchors.verticalCenter: parent.verticalCenter
                    width: Math.max(0, entryDuration.x - x - Style.space(10))
                    spacing: Style.space(3)
                    Text {
                      width: parent.width
                      text: String(entryRow.project && entryRow.project.title || entryRow.modelData.projectName || "Project " + entryRow.modelData.projectId)
                      color: entryRow.contentColor
                      font.family: root.fontFamily
                      font.bold: true
                      wrapMode: Text.Wrap
                    }
                    Text {
                      width: parent.width
                      text: root.serviceName(entryRow.project, entryRow.modelData.serviceId) || entryRow.modelData.serviceName || (entryRow.modelData.serviceId ? "Service " + entryRow.modelData.serviceId : "No service")
                      color: entryRow.contentColor
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                      wrapMode: Text.Wrap
                    }
                    Text {
                      width: parent.width
                      text: String(entryRow.modelData.note || "No notes")
                      color: entryRow.contentColor
                      opacity: 0.7
                      elide: Text.ElideRight
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                    }
                    Text {
                      width: parent.width
                      visible: text !== ""
                      text: root.recordStatusLabel(entryRow.modelData)
                      color: text === "Could not save" || text === "Needs field choices" ? Color.urgent : Color.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                    }
                  }
                  Text { id: entryDuration; anchors.right: resumeEntryButton.left; anchors.rightMargin: Style.space(10); anchors.verticalCenter: parent.verticalCenter; text: Model.formatDuration(modelData.durationSeconds !== undefined ? modelData.durationSeconds : modelData.duration || 0); color: entryRow.contentColor; font.family: root.fontFamily }
                  MouseArea {
                    anchors.left: parent.left
                    anchors.right: resumeEntryButton.left
                    height: parent.height
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onContainsMouseChanged: {
                      if (!containsMouse) return
                      root.cursorActive = true
                      root.keyboardCursor = index * 2 + 1
                      root.calendarGridFocused = false
                    }
                    onClicked: root.beginEditEntry(modelData)
                  }
                  ActionButton {
                    id: resumeEntryButton
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    label: ""
                    iconText: entryRow.running ? "󰓛" : "󰐊"
                    tooltipText: entryRow.running ? "Stop timer" : "Resume timer"
                    implicitWidth: Style.space(38)
                    implicitHeight: Style.space(38)
                    enabled: !root.activeTimer || root.canMutateRecord(root.activeTimer)
                    cursorIndex: entryRow.index * 2 + 2
                    calendarListTarget: true
                    hasCursor: root.cursorActive && !root.calendarGridFocused && root.keyboardCursor === cursorIndex
                    onTriggered: root.resumeEntry(entryRow.modelData)
                  }
                }
              }
            }
          }
          }
        }
      }
      Popup {
        id: entryDialog
        parent: keyCatcher
        x: Style.space(8)
        y: Math.max(0, (parent.height - height) / 2)
        width: Math.max(0, parent.width - Style.space(16))
        height: Math.min(parent.height, calendarEditor.implicitHeight + padding * 2)
        padding: Style.space(14)
        modal: true
        dim: true
        focus: true
        closePolicy: Popup.NoAutoClose
        visible: root.opened && !root.setupRequired && root.tab === "calendar" && root.entryEditorMode !== "closed"
        onOpened: {
          entryEditorViewport.contentY = 0
          entryNoteField.forceActiveFocus()
        }
        onClosed: entryProjectPicker.close()
        Overlay.modal: Rectangle { color: "#99000000" }
        background: Rectangle {
          color: Color.popups.background
          radius: Style.space(10)
          border.width: 1
          border.color: root.foreground
        }
        contentItem: Flickable {
          id: entryEditorViewport
          contentHeight: calendarEditor.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height
          ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
          Keys.onEscapePressed: function(event) { root.close(); event.accepted = true }
          Column {
            id: calendarEditor
            width: entryEditorViewport.width
            spacing: Style.space(7)
            Text { text: root.entryEditorMode === "create" ? "Add time entry" : "Edit time entry"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
            TextField { id: entryDateField; width: parent.width; placeholderText: "YYYY-MM-DD"; onTextEdited: { root.entryDateKey = text; root.entryDateDirty = text !== root.entryOriginalDateKey } }
            TextField { id: entryNoteField; width: parent.width; placeholderText: "Notes"; onTextEdited: root.entryNoteDirty = text !== root.entryOriginalNote }
            TextField { id: entryDurationField; width: parent.width; placeholderText: "HH:MM or HH:MM:SS"; onTextEdited: root.entryDurationDirty = Model.parseDurationInput(text) !== root.entryOriginalDurationSeconds; onAccepted: root.saveEntry() }
            PanelSectionHeader { text: "PROJECT AND SERVICE"; foreground: root.foreground; fontFamily: root.fontFamily }
            SearchableDropdown {
              id: entryProjectPicker
              width: parent.width
              showLabel: false
              placeholderText: "Search projects, clients, or services"
              emptyText: "No matching projects or services"
              triggerLabel: "Select a project"
              foreground: root.foreground
              fontFamily: root.fontFamily
              options: {
                var choices = Model.projectShortcuts(root.orderedProjects).map(function(shortcut) {
                  return {
                    value: JSON.stringify([String(shortcut.projectId), shortcut.serviceId == null ? "" : String(shortcut.serviceId)]),
                    label: String(shortcut.project.clientName || "Internal") + " · "
                      + String(shortcut.project.title || shortcut.project.name || "Project"),
                    description: String(shortcut.serviceName || "No service")
                  }
                })
                // Keep an existing selection readable even when it is no longer offered.
                var selected = JSON.stringify([root.entryProjectId, root.entryServiceId])
                var project = root.projectById(root.entryProjectId)
                if (project && !choices.some(function(choice) { return choice.value === selected })) {
                  var service = root.serviceName(project, root.entryServiceId)
                  choices.unshift({ value: selected, label: String(project.clientName || "Internal")
                    + " · " + String(project.title || project.name || "Project"),
                    description: service || "No service" })
                }
                return choices
              }
              onChanged: function(value) {
                var selection = JSON.parse(value)
                root.entryProjectId = selection[0]
                root.entryServiceId = selection[1]
                root.entryAssignmentDirty = root.entryProjectId !== root.entryOriginalProjectId
                  || root.entryServiceId !== root.entryOriginalServiceId
              }
              Binding {
                target: entryProjectPicker
                property: "value"
                value: root.entryProjectId === "" ? "" : JSON.stringify([root.entryProjectId, root.entryServiceId])
              }
            }
            Text {
              width: parent.width
              visible: root.entryProjectId !== ""
              textFormat: Text.PlainText
              text: "Service: " + (root.serviceName(root.projectById(root.entryProjectId), root.entryServiceId) || "No service")
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.Wrap
            }
            Text {
              width: parent.width
              visible: text !== ""
              text: root.entryEditorMode === "edit"
                ? root.recordStatusLabel({ kind: "time-entry", id: root.editingEntryId })
                : ""
              color: Color.urgent
              font.family: root.fontFamily
              wrapMode: Text.Wrap
            }
            Flow {
              width: parent.width
              spacing: Style.space(8)
              ActionButton {
                label: "Save"
                enabled: (root.entryEditorMode === "create"
                    || (root.entryHasDirtyFields && root.canMutateScope("time-entry:" + root.editingEntryId)))
                  && Model.parseDurationInput(entryDurationField.text) !== null
                  && root.entryProjectId !== "" && Model.parseDateKey(root.entryDateKey)
                onTriggered: root.saveEntry()
              }
              ActionButton { label: "Cancel"; onTriggered: root.cancelEntryEditor() }
              ActionButton {
                id: deleteEntryButton
                visible: root.entryEditorMode === "edit"
                enabled: root.canMutateScope("time-entry:" + root.editingEntryId)
                label: root.confirmingDelete ? "Delete now" : "Delete"
                onTriggered: {
                  if (!root.confirmingDelete) root.confirmingDelete = true
                  else root.deleteEditedEntry()
                }
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
    opacity: enabled || iconSpinning ? 1 : 0.45

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
  }
}
