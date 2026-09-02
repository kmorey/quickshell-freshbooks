import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "ServiceAccess.js" as ServiceAccess
import "TimeTrackingModel.js" as Model

BarWidget {
  id: root
  moduleName: "kmorey.freshbooks-time"

  readonly property var timeTracking: ServiceAccess.serviceFor(bar ? bar.shell : null, moduleName)
  readonly property var activeTimer: timeTracking ? timeTracking.activeTimer : null
  readonly property string timerMode: timeTracking ? timeTracking.timerMode : "none"
  readonly property string label: {
    if (!timeTracking) return "FreshBooks"
    if (timerMode === "multiple") return "Choose timer"
    if (!activeTimer) return "FreshBooks"
    return Model.formatDuration(Model.elapsedSeconds(activeTimer, clock.date.getTime()))
  }
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }
  function togglePanel() { if (panelLoader.item) panelLoader.item.toggle() }
  function openCalendar() {
    if (!panelLoader.item) return
    panelLoader.item.tab = "calendar"
    panelLoader.item.open()
  }

  function boundedStatus() {
    return JSON.stringify({
      ready: root.timeTracking !== null,
      opened: root.opened,
      timerMode: root.timerMode,
      running: root.activeTimer ? root.activeTimer.running === true : false,
      busy: root.timeTracking ? root.timeTracking.busy === true : false,
      cliVersion: root.timeTracking ? String((root.timeTracking.diagnostics || {}).version || "") : "",
      authenticated: root.timeTracking ? (root.timeTracking.diagnostics || {}).authenticated === true : false,
      businessSelected: root.timeTracking ? (root.timeTracking.diagnostics || {}).businessSelected === true : false,
      lastErrorCode: root.timeTracking ? String(root.timeTracking.lastErrorCode || "") : "SERVICE_UNAVAILABLE"
    })
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    target.bar = root.bar
    target.anchorItem = button
    target.hostWidget = root
    target.timeTracking = root.timeTracking
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  SystemClock {
    id: clock
    precision: SystemClock.Seconds
  }

  onBarChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: { root.injectPanel(); Qt.callLater(root.injectPanel) }
  }

  IpcHandler {
    target: "kmorey.freshbooks-time"
    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function openCalendar(): void { root.openCalendar() }
    function refresh(): void { if (root.timeTracking) root.timeTracking.refresh() }
    function status(): string { return root.boundedStatus() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.vertical ? "" : root.label
    labelVisible: !root.vertical
    tooltipText: root.timerMode === "multiple"
      ? "FreshBooks has multiple unlogged timers"
      : "Refresh FreshBooks time tracking"
    horizontalMargin: 8.75
    verticalPadding: 8.75
    onPressed: function() {
      root.togglePanel()
    }

    OpticalGlyph {
      visible: root.vertical
      anchors.centerIn: parent
      text: "󱑂"
      fontFamily: button.fontFamily
      fontSize: button.fontSize
      color: button.foreground
    }
  }
}
