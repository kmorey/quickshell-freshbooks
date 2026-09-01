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

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  SystemClock {
    id: clock
    precision: SystemClock.Seconds
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
      if (root.timeTracking) root.timeTracking.refresh()
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
