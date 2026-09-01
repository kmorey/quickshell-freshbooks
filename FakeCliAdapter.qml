import QtQuick
import "FakeCliModel.js" as FakeCliModel

Item {
  id: root

  property var script: []
  property var requests: []
  readonly property bool busy: false

  signal succeeded(string requestId, var data)
  signal failed(string requestId, var error)

  function execute(requestId, request) {
    var seen = requests.slice()
    seen.push(request)
    requests = seen

    var consumed = FakeCliModel.consume(script, request)
    script = consumed.remaining
    Qt.callLater(function() {
      if (consumed.result.ok) root.succeeded(requestId, consumed.result.data)
      else root.failed(requestId, consumed.result.error)
    })
  }

  function cancel() {}
}
