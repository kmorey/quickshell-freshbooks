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

test('offline startup preserves pending edits, timer segments, and cached project services', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'freshbooks-service-restore-'))
  try {
    const pluginRoot = path.resolve(process.env.FRESHBOOKS_PLUGIN_SOURCE || path.join(__dirname, '..'))
    for (const file of fs.readdirSync(pluginRoot)) {
      if (/\.js$/.test(file) || ['Service.qml', 'CliAdapter.qml', 'LedgerStore.qml', 'ProjectCache.qml'].includes(file))
        fs.copyFileSync(path.join(pluginRoot, file), path.join(stage, file))
    }
    const Ledger = require('../OperationLedger.js')
    const Store = require('../LedgerStoreModel.js')
    const token = 'a'.repeat(64)
    const entry = {
      contractVersion: 2, kind: 'time-entry', id: '9', exists: true, token,
      localDate: '2026-09-02', startedAt: '2026-09-02T17:00:00.000Z',
      durationSeconds: 3600, projectId: '44', clientId: '55', serviceId: '66',
      note: 'Original note', billable: true, billed: false,
    }
    const timer = {
      contractVersion: 2, kind: 'active-timer', id: '901', exists: true, token,
      state: 'paused', projectId: '44', clientId: '55', serviceId: '66',
      note: 'Unsaved timer', billable: true,
      elapsedAnchor: { closedSeconds: 1800, runningStartedAt: null, observedAt: '2026-09-02T17:30:00.000Z' },
      segments: [{
        contractVersion: 2, kind: 'timer-segment', id: '10', timerId: '901',
        exists: true, token, startedAt: '2026-09-02T17:00:00.000Z',
        durationSeconds: 1800, running: false, logged: false,
      }],
    }
    const prepared = Ledger.apply(Ledger.initialState({ records: [entry, timer] }), {
      type: 'intent',
      intent: {
        type: 'save-entry', scope: 'time-entry:9', base: entry, baseToken: token,
        patch: { note: 'Preserved pending note' }, draft: { note: 'Preserved pending note' },
        argv: ['time', 'update', '9', '--note', 'Preserved pending note', '--guard', token],
        commandClass: 'single-write',
      },
    })
    const snapshot = Store.serialize(prepared.effects.find(effect => effect.type === 'persist').snapshot)
    const cache = JSON.stringify({
      schemaVersion: 1, updatedAt: '2026-09-02T17:00:00.000Z',
      projects: [{
        id: 44, title: 'Build', clientId: 55, clientName: 'Acme',
        active: true, complete: false, internal: false,
        services: [{ id: 66, name: 'Development', billable: true }],
      }],
    })
    fs.writeFileSync(path.join(stage, 'shell.qml'), `
import QtQuick
import Quickshell
import Quickshell.Io
ShellRoot {
  id: root
  property int seeded: 0
  function fail(message) { console.error("RESTORE_FAIL", message); Qt.exit(2) }
  FileView {
    id: ledgerSeed
    printErrors: false
    path: Quickshell.statePath("kmorey.freshbooks-operation-ledger.json")
    onLoadFailed: Qt.callLater(function() { ledgerSeed.setText(${JSON.stringify(snapshot)}) })
    onSaved: root.seeded++
  }
  FileView {
    id: cacheSeed
    printErrors: false
    path: Quickshell.cachePath("kmorey.freshbooks-projects.json")
    onLoadFailed: Qt.callLater(function() { cacheSeed.setText(${JSON.stringify(cache)}) })
    onSaved: root.seeded++
  }
  Loader {
    id: loader
    active: root.seeded === 2
    sourceComponent: Component {
      Service { cliAdapter: CliAdapter { executable: "/usr/bin/false" } }
    }
  }
  Timer {
    interval: 20; repeat: true; running: true
    onTriggered: {
      var service = loader.item
      if (!service || service.cliAdapter.busy || service.lastErrorCode === "") return
      var timer = service.activeTimer
      var project = service.view.projects[0]
      var operation = service.view.operations[0]
      if (!timer || timer.id !== "901" || timer.state !== "paused"
          || timer.note !== "Unsaved timer" || timer.elapsedAnchor.closedSeconds !== 1800
          || timer.segments.length !== 1 || timer.segments[0].id !== "10"
          || timer.segments[0].durationSeconds !== 1800)
        return root.fail("persisted timer or segment lost")
      if (!project || project.id !== 44 || project.services[0].id !== 66
          || project.services[0].name !== "Development")
        return root.fail("cached project or nested service lost")
      if (!operation || operation.operationId !== "operation-1" || operation.state !== "unknown"
          || service.view.records["time-entry:9"].note !== "Preserved pending note")
        return root.fail("pending edit was lost or treated as applied")
      console.log("RESTORE_PASS")
      Qt.quit()
    }
  }
  Timer { interval: 5000; running: true; onTriggered: root.fail("startup stalled") }
}
`)
    const result = spawnSync('qs', ['-p', stage], {
      encoding: 'utf8', timeout: 10000,
      env: {
        ...process.env, HOME: path.join(stage, 'home'),
        XDG_CONFIG_HOME: path.join(stage, 'config'), XDG_STATE_HOME: path.join(stage, 'state'),
        XDG_CACHE_HOME: path.join(stage, 'cache'),
      },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /RESTORE_PASS/)
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
})
