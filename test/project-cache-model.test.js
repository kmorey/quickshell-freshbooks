const test = require('node:test')
const assert = require('node:assert/strict')

const Cache = require('../ProjectCacheModel.js')

const projects = [{
  id: 44,
  title: 'Build',
  clientId: 55,
  clientName: 'Acme',
  active: true,
  complete: false,
  internal: false,
  services: [{ id: 66, name: 'Development', billable: true }]
}]

test('project cache round-trips a versioned confirmed project list', () => {
  const text = Cache.serialize(projects, '2026-10-02T22:00:00.000Z')
  assert.deepEqual(Cache.deserialize(text), {
    projects,
    updatedAt: '2026-10-02T22:00:00.000Z'
  })
})

test('project cache discards missing, corrupt, and incompatible data', () => {
  for (const text of ['', '{', '{"schemaVersion":2,"projects":[]}', '{"schemaVersion":1,"projects":{}}']) {
    assert.deepEqual(Cache.deserialize(text), { projects: [], updatedAt: null })
  }
})
