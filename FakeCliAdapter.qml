import QtQuick
import "FakeCliModel.js" as FakeCliModel

Item {
  id: root

  property var script: []
  property var requests: []
  property var modelState: FakeCliModel.initialState(script)
  property bool autoStart: true
  property bool autoComplete: true
  readonly property bool busy: modelState.active !== null
  readonly property int remainingSteps: modelState.script.length

  signal completed(var completion)
  signal stepCompleted(var request, var completion, int remainingSteps)
  signal requestExecuted(var request)

  onScriptChanged: if (!busy && modelState.pending.length === 0)
    modelState = FakeCliModel.initialState(script)

  function execute(request) {
    var seen = requests.slice()
    seen.push(request)
    requests = seen
    requestExecuted(request)
    var transition = FakeCliModel.enqueue(modelState, request)
    modelState = transition.state
    if (autoStart) startNext()
    return true
  }
  function startNext() {
    var transition = FakeCliModel.startNext(modelState)
    modelState = transition.state
    if (!transition.started) return false
    if (autoComplete) {
      var step = modelState.script.length > 0 ? modelState.script[0] : ({})
      completionTimer.interval = Math.max(0, Number(step.delayMs || 0))
      completionTimer.restart()
    }
    return true
  }

  function completeNext() {
    if (!modelState.active) return false
    completionTimer.stop()
    canceledCompletionTimer.stop()
    var request = modelState.active.request
    var finished = FakeCliModel.completeActive(modelState)
    modelState = finished.state
    script = finished.state.script
    if (finished.completion) {
      completed(finished.completion)
      stepCompleted(request, finished.completion, finished.state.script.length)
    }
    if (autoStart) Qt.callLater(startNext)
    return finished.completion !== null
  }

  Timer {
    id: completionTimer
    interval: 0
    repeat: false
    onTriggered: root.completeNext()
  }

  Timer {
    id: canceledCompletionTimer
    interval: 250
    repeat: false
    onTriggered: root.completeNext()
  }

  function cancelRead(requestId) {
    var transition = FakeCliModel.cancelRead(modelState, requestId)
    modelState = transition.state
    if (transition.canceled && autoComplete) {
      completionTimer.stop()
      canceledCompletionTimer.restart()
    }
    return transition.canceled
  }
}
