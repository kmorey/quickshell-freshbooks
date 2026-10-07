'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const token = 'a'.repeat(64)
const instant = '2026-10-01T12:00:00.000Z'
function timer(id, state, note) {
  const running = state === 'running'
  return {
    contractVersion: 2, kind: 'active-timer', id, exists: true,
    segments: [{ contractVersion: 2, kind: 'timer-segment', id: `segment-${id}`, timerId: id,
      exists: true, startedAt: instant, durationSeconds: running ? null : 1800,
      running, logged: false, token }],
    state, elapsedAnchor: { closedSeconds: running ? 0 : 1800,
      runningStartedAt: running ? instant : null, observedAt: instant },
    projectId: '44', serviceId: '66', clientId: '55', note, billable: true, token
  }
}
const logged = {
  contractVersion: 2, kind: 'time-entry', id: 'saved-entry', exists: true,
  localDate: '2026-10-01', startedAt: instant, durationSeconds: 1800,
  projectId: '44', serviceId: '66', clientId: '55', note: 'Previous task',
  billable: true, billed: false, token
}
const diagnostics = JSON.parse(fs.readFileSync(path.join(__dirname, 'smoke-script.json'), 'utf8')).steps[0]

for (const state of ['running', 'paused', 'saved']) {
  test(`Projects starts a distinct blank-note session after a ${state} timer`, () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'freshbooks-project-start-'))
    try {
      const repo = path.resolve(__dirname, '..')
      for (const file of fs.readdirSync(repo)) {
        if (/\.(qml|js)$/.test(file)) fs.copyFileSync(path.join(repo, file), path.join(stage, file))
      }
      const shell = path.join(process.env.OMARCHY_PATH || '/usr/share/omarchy', 'shell')
      for (const module of ['Commons', 'Ui']) fs.symlinkSync(path.join(shell, module), path.join(stage, module))
      const old = state === 'saved' ? null : timer('old-timer', state, logged.note)
      const fresh = timer('new-timer', 'running', '')
      const snapshot = { schemaVersion: 1, operations: [], records: old
        ? { 'active-timer:old-timer': old } : { 'time-entry:saved-entry': logged } }
      const results = old ? [logged, { contractVersion: 2, kind: 'active-timer', id: old.id, exists: false, token: null }, fresh] : [fresh]
      const changes = old ? [
        { scope: 'time-entry:saved-entry', before: { absent: true }, after: { record: logged } },
        { scope: 'active-timer:old-timer', before: { token }, after: { deleted: true } }
      ] : []
      changes.push({ scope: 'active-timer:new-timer', before: { absent: true }, after: { record: fresh } })
      const step = { requestKind: 'mutation',
        scope: old ? 'provisional:operation-1:timer-switch-target' : 'provisional:operation-1:active-timer-create',
        outcome: 'receipt', data: { contractVersion: 2, mutationKind: old ? 'timer-switch' : 'timer-start',
          changes, results, phase: old ? { log: 'confirmed', start: 'confirmed' } : null } }
      fs.writeFileSync(path.join(stage, 'shell.qml'), `
import QtQuick
import Quickshell
ShellRoot {
  id: root
  property string phase: "ready"
  function fail(message) { console.error("PROJECT_START_FAIL", message); Qt.quit() }
  FakeCliAdapter { id: adapter; Component.onCompleted: script = ${JSON.stringify([diagnostics])} }
  Service { id: service; cliAdapter: adapter }
  Panel { id: panel; timeTracking: service }
  Timer {
    interval: 20; running: true; repeat: true
    onTriggered: {
      if (root.phase === "ready" && service.diagnosticsReady && !adapter.busy) {
        service.runtime.startup(${JSON.stringify(snapshot)})
        service.publishView()
        adapter.script = ${JSON.stringify([step])}
        root.phase = "waiting"
        panel.startShortcut({ projectId: "44", serviceId: "66" })
      } else if (root.phase === "waiting" && service.view.operations.length > 0
          && service.view.operations[0].state === "settled") {
        var records = service.view.records
        var saved = records["time-entry:saved-entry"]
        var fresh = records["active-timer:new-timer"]
        if (records["active-timer:old-timer"] || !fresh || fresh.note !== ""
            || fresh.state !== "running" || fresh.elapsedAnchor.closedSeconds !== 0
            || !saved || saved.note !== "Previous task" || saved.durationSeconds !== 1800) {
          root.fail("The previous task or fresh session was not preserved independently")
          return
        }
        console.log("PROJECT_START_PASS")
        Qt.quit()
      } else if (root.phase === "waiting" && service.lastErrorCode !== "") {
        root.fail(service.lastErrorCode)
      }
    }
  }
  Timer { interval: 4000; running: true; onTriggered: root.fail("Project selection did not create a fresh session") }
}
`)
      const result = spawnSync('qs', ['-p', stage], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, XDG_STATE_HOME: path.join(stage, 'state'), XDG_CACHE_HOME: path.join(stage, 'cache') } })
      assert.ifError(result.error)
      const output = result.stdout + result.stderr
      assert.equal(result.status, 0, output)
      assert.match(output, /PROJECT_START_PASS/)
      assert.doesNotMatch(output, /PROJECT_START_FAIL/)
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  })
}
