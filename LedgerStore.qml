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

  function save(snapshot, transactionId) {
    var id = String(transactionId || "")
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
    ledgerFile.setText(serialized)
  }

  FileView {
    id: ledgerFile
    path: root.path
    atomicWrites: true
    printErrors: false

    onLoaded: root.publishLoad(LedgerStoreModel.deserialize(String(text() || "")))
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
    onSaved: {
      var transactionId = root._pendingTransactionId
      root._pendingTransactionId = ""
      root.saved(transactionId)
    }
    onSaveFailed: function(error) {
      var transactionId = root._pendingTransactionId
      root._pendingTransactionId = ""
      root.failed(transactionId, error)
    }
  }
}
