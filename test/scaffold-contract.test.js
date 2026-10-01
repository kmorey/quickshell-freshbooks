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
  assert.equal(manifest.barWidget.defaultSection, 'right')
})
