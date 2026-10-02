import QtQuick
import "FakeCliModel.js" as FakeCliModel

Item {
  id: root

  property var script: []
  property var requests: []
  property var modelState: FakeCliModel.initialState(script)
  property bool autoStart: true
  readonly property bool busy: modelState.active !== null

  signal completed(var completion)

  onScriptChanged: if (!busy && modelState.pending.length === 0)
    modelState = FakeCliModel.initialState(script)

  function execute(request) {
    var seen = requests.slice()
    seen.push(request)
    requests = seen
    var transition = FakeCliModel.enqueue(modelState, request)
    modelState = transition.state
    if (autoStart) startNext()
    return true
  }

  function startNext() {
    var transition = FakeCliModel.startNext(modelState)
    modelState = transition.state
    if (!transition.started) return false
    Qt.callLater(function() {
      var finished = FakeCliModel.completeActive(root.modelState)
      root.modelState = finished.state
      root.script = finished.state.script
      if (finished.completion) root.completed(finished.completion)
      if (root.autoStart) root.startNext()
    })
    return true
  }

  function cancelRead(requestId) {
    var transition = FakeCliModel.cancelRead(modelState, requestId)
    modelState = transition.state
    return transition.canceled
  }
}
