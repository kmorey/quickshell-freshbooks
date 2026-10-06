'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

for (const existing of [false, true]) {
  test(`ledger persists callback-chained transitions and unchanged snapshots (${existing ? 'existing' : 'missing'} file)`, () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'freshbooks-ledger-runtime-'))
    try {
      for (const file of ['LedgerStore.qml', 'LedgerStoreModel.js'])
        fs.copyFileSync(path.join(__dirname, '..', file), path.join(stage, file))
      const ledgerPath = path.join(stage, 'ledger.json')
      const empty = { schemaVersion: 1, operations: [], records: {} }
      if (existing) fs.writeFileSync(ledgerPath, JSON.stringify(empty))
      fs.writeFileSync(path.join(stage, 'shell.qml'), `
import QtQuick
import Quickshell
ShellRoot {
  id: root
  property int step: 0
  property var snapshot: ({schemaVersion: 1, operations: [], records: {}})
  function fail(message) { console.error("PERSISTENCE_FAIL", message); Qt.quit() }
  LedgerStore {
    id: store
    path: ${JSON.stringify(ledgerPath)}
    onLoaded: function(snapshot, error) {
      if (error) { root.fail(JSON.stringify(error)); return }
      store.save(root.snapshot, "initial")
    }
    onSaved: function(transactionId) {
      if (root.step === 0 && transactionId === "initial") {
        root.step = 1
        root.snapshot = {schemaVersion: 1, operations: [], records: {
          "active-timer:proof": {contractVersion: 2, kind: "active-timer", id: "proof", exists: false, token: null}
        }}
        store.save(root.snapshot, "changed")
      } else if (root.step === 1 && transactionId === "changed") {
        root.step = 2
        store.save(root.snapshot, "unchanged")
      } else if (root.step === 2 && transactionId === "unchanged") {
        console.log("PERSISTENCE_PASS")
        Qt.quit()
      } else root.fail("Unexpected transition: " + transactionId)
    }
    onFailed: function(transactionId, error) { root.fail(transactionId + ": " + JSON.stringify(error)) }
  }
  Timer {
    interval: 3000; running: true
    onTriggered: root.fail("Stalled at transition " + root.step)
  }
}
`)
      const result = spawnSync('qs', ['-p', stage], { encoding: 'utf8', timeout: 10000 })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout + result.stderr, /PERSISTENCE_PASS/)
      assert.doesNotMatch(result.stdout + result.stderr, /PERSISTENCE_FAIL/)
      assert.deepEqual(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')), {
        schemaVersion: 1,
        operations: [],
        records: { 'active-timer:proof': {
          contractVersion: 2, kind: 'active-timer', id: 'proof', exists: false, token: null
        } }
      })
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  })
}
