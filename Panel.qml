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
    ? Model.searchProjects(Model.recentProjectOrder(timeTracking.projects, timeTracking.entries, timeTracking.activeTimer ? timeTracking.activeTimer.projectId : ""), projectSearch)
    : []
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

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
    if (timeTracking) timeTracking.registerVisibleConsumer("freshbooks-panel")
  }

  function close() {
    if (timeTracking) timeTracking.unregisterVisibleConsumer("freshbooks-panel")
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

  function startProject(project) {
    if (!timeTracking) return
    var serviceId = projectServiceId(project)
    if (timeTracking.activeTimer) timeTracking.switchTimer(project.id, serviceId)
    else timeTracking.start(project.id, serviceId, "")
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
              text: root.timeTracking && root.timeTracking.activeTimer ? String(root.timeTracking.activeTimer.note || "") : ""
              onEditingFinished: if (root.timeTracking && enabled && text !== String(root.timeTracking.activeTimer.note || "")) root.timeTracking.updateTimerNote(text)
            }
            TextField {
              id: durationField
              width: parent.width
              enabled: root.timeTracking && root.timeTracking.activeTimer
              placeholderText: "HH:MM or HH:MM:SS"
              text: root.timeTracking && root.timeTracking.activeTimer ? Model.formatDuration(root.timeTracking.activeTimer.elapsedSeconds) : ""
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
                  model: root.orderedProjects
                  Rectangle {
                    required property var modelData
                    width: projectColumn.width
                    height: Style.space(46)
                    radius: Style.cornerRadius
                    color: projectMouse.containsMouse ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.12) : "transparent"
                    Text { anchors.left: parent.left; anchors.leftMargin: Style.space(10); anchors.verticalCenter: parent.verticalCenter; width: parent.width - Style.space(60); text: String(modelData.clientName || "") + (modelData.clientName ? " · " : "") + String(modelData.title || modelData.name || "Project"); elide: Text.ElideRight; color: root.foreground; font.family: root.fontFamily }
                    Text { anchors.right: parent.right; anchors.rightMargin: Style.space(12); anchors.verticalCenter: parent.verticalCenter; text: root.timeTracking && root.timeTracking.activeTimer && String(root.timeTracking.activeTimer.projectId) === String(modelData.id) && root.timeTracking.activeTimer.running ? "Ⅱ" : "▶"; color: Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.title }
                    MouseArea { id: projectMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.startProject(modelData) }
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
            Text { text: root.selectedDateKey + " · " + Model.formatDuration(Model.reportingWeekTotal(root.timeTracking ? root.timeTracking.entries : [], root.selectedDateKey)) + " this week"; color: root.foreground; font.family: root.fontFamily; font.bold: true }
            Flickable {
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
}
