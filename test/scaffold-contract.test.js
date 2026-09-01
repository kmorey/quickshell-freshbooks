const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

test('declares one installable service plus bar-widget plugin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, 'kmorey.freshbooks-time')
  assert.deepEqual(manifest.kinds, ['service', 'bar-widget'])
  assert.equal(manifest.keepLoaded, true)
  assert.equal(manifest.entryPoints.service, 'Service.qml')
  assert.equal(manifest.entryPoints.barWidget, 'BarWidget.qml')
  assert.equal(manifest.barWidget.allowMultiple, false)
})

test('uses the generic third-party service lookup compatibility seam', () => {
  const access = fs.readFileSync(path.join(root, 'ServiceAccess.js'), 'utf8')
  const widget = fs.readFileSync(path.join(root, 'BarWidget.qml'), 'utf8')
  assert.match(access, /shell\.serviceFor/)
  assert.doesNotMatch(access + widget, /firstPartyServiceFor/)
  assert.match(widget, /ServiceAccess\.serviceFor/)
})

test('keeps FreshBooks invocation as an argv array with no command shell', () => {
  const adapter = fs.readFileSync(path.join(root, 'CliAdapter.qml'), 'utf8')
  assert.match(adapter, /\[executable\]\.concat\(argv\)\.concat\(\["--json"\]\)/)
  assert.doesNotMatch(adapter, /sh",\s*"-c|bash",\s*"-c/)
  assert.match(adapter, /CLI_TIMEOUT/)
  assert.match(adapter, /INVALID_JSON/)
})

test('exposes one deep intent module and an injectable deterministic adapter', () => {
  const service = fs.readFileSync(path.join(root, 'Service.qml'), 'utf8')
  for (const intent of [
    'refresh',
    'start',
    'pause',
    'resume',
    'correctDuration',
    'updateTimerNote',
    'logTimer',
    'switchTimer',
    'createEntry',
    'updateEntry',
    'deleteEntry'
  ]) assert.match(service, new RegExp(`function ${intent}\\(`))
  assert.match(service, /property var cliAdapter: productionCli/)
  assert.match(service, /function useAdapter\(adapter\)/)
  assert.equal((service.match(/CliAdapter\s*\{/g) || []).length, 1)
})
