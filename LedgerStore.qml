import QtQuick
import Quickshell
import Quickshell.Io
import "LedgerStoreModel.js" as LedgerStoreModel

Item {
  id: root

  property string path: Quickshell.statePath("kmorey.freshbooks-operation-ledger.json")
  property var restoredSnapshot: null
  property var recoveryError: null
  property string unreadText: ""
  property bool ready: false
  property string _pendingTransactionId: ""
  property string _pendingText: ""
  property var _durableText: null
  readonly property bool recoveryLocked: recoveryError !== null

  signal loaded(var snapshot, var recoveryError, string unreadText)
  signal saved(string transactionId)
  signal failed(string transactionId, var error)

  function publishLoad(result) {
    restoredSnapshot = result.snapshot
    recoveryError = result.recoveryError
    unreadText = result.unreadText
    ready = true
    loaded(restoredSnapshot, recoveryError, unreadText)
  }

  function completeSave() {
    var transactionId = _pendingTransactionId
    _durableText = _pendingText
    _pendingTransactionId = ""
    _pendingText = ""
    saved(transactionId)
  }

  function save(snapshot, transactionId) {
    var id = String(transactionId || "")
    if (!ready) {
      failed(id, { code: "LEDGER_NOT_READY", message: "The operation ledger is still loading." })
      return
    }
    if (recoveryLocked) {
      failed(id, { code: "LEDGER_RECOVERY_LOCKED", message: "Recover the unread ledger before saving." })
      return
    }
    if (_pendingTransactionId !== "") {
      failed(id, { code: "LEDGER_WRITE_BUSY", message: "A ledger write is already pending." })
      return
    }
    var serialized
    try {
      serialized = LedgerStoreModel.serialize(snapshot)
    } catch (error) {
      failed(id, { code: "LEDGER_SERIALIZE_FAILED", message: String(error) })
      return
    }
    _pendingTransactionId = id
    _pendingText = serialized
    // FileView is still completing its previous operation inside loaded/saved
    // handlers. Defer the next write until that callback has returned.
    Qt.callLater(function() {
      // setText emits no saved signal for unchanged content. Only acknowledge
      // bytes confirmed by a successful load/write, never an optimistic buffer.
      if (serialized === root._durableText) root.completeSave()
      else ledgerFile.setText(serialized)
    })
  }

  FileView {
    id: ledgerFile
    path: root.path
    atomicWrites: true
    printErrors: false

    onLoaded: {
      root._durableText = String(text() || "")
      root.publishLoad(LedgerStoreModel.deserialize(root._durableText))
    }
    onLoadFailed: {
      var unread = String(text() || "")
      if (unread !== "") root.publishLoad(LedgerStoreModel.deserialize(unread))
      else root.publishLoad({
        snapshot: { schemaVersion: 1, operations: [], records: {} },
        recoveryError: null,
        unreadText: "",
        effects: []
      })
    }
    onSaved: root.completeSave()
    onSaveFailed: function(error) {
      var transactionId = root._pendingTransactionId
      root._pendingTransactionId = ""
      root._pendingText = ""
      root.failed(transactionId, error)
    }
  }
}
