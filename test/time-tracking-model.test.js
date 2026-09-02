const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../TimeTrackingModel.js')

test('validates and moves local date keys without DST-sensitive local arithmetic', () => {
  assert.deepEqual(model.parseDateKey('2026-03-08'), { year: 2026, month: 3, day: 8 })
  assert.equal(model.parseDateKey('2026-02-30'), null)
  assert.equal(model.addDays('2026-03-08', 1), '2026-03-09')
  assert.equal(model.addDays('2026-12-31', 1), '2027-01-01')
})

test('builds fixed Sunday-first six-row calendar grids', () => {
  const cells = model.calendarMonth(2026, 9)
  assert.equal(cells.length, 42)
  assert.equal(cells[0].key, '2026-08-30')
  assert.equal(cells[0].column, 0)
  assert.equal(cells[6].column, 6)
  assert.equal(cells[41].key, '2026-10-10')
  assert.equal(cells.filter(cell => cell.inMonth).length, 30)
})

test('defines Reporting Weeks as Sunday through Saturday across year boundaries', () => {
  assert.deepEqual(model.sundayWeek('2027-01-01'), {
    start: '2026-12-27',
    end: '2027-01-02',
    days: [
      '2026-12-27',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02'
    ]
  })
})

test('aggregates only logged Time Entry durations with normalized FreshBooks-local dates', () => {
  const entries = [
    { localDate: '2026-08-30', durationSeconds: 3600 },
    { localDate: '2026-08-30', durationSeconds: 900.4 },
    { localDate: '2026-09-05', duration: 1800 },
    { localDate: 'invalid', durationSeconds: 9999 }
  ]
  assert.deepEqual(model.aggregateEntries(entries), {
    byDay: { '2026-08-30': 4500, '2026-09-05': 1800 },
    totalSeconds: 6300
  })
  assert.equal(model.reportingWeekTotal(entries, '2026-09-02'), 6300)
  assert.equal(model.reportingWeekTotal(entries, '2026-09-06'), 0)
})

test('projects zero, one, and multiple remote timers explicitly', () => {
  assert.equal(model.timerMode([]), 'none')
  assert.equal(model.timerMode([{ id: 1 }]), 'single')
  assert.equal(model.timerMode([{ id: 1 }, { id: 2 }]), 'multiple')
  assert.equal(model.selectedTimer([{ id: 1 }, { id: 2 }], ''), null)
  assert.equal(model.selectedTimer([{ id: 1 }, { id: 2 }], 2).id, 2)

  const projected = model.stateProjection({ activeTimers: [{ id: 7 }, { id: 8 }] }, 8)
  assert.equal(projected.timerMode, 'multiple')
  assert.equal(projected.activeTimer.id, 8)
  assert.equal(projected.timerCandidates.length, 2)
})

test('detects remote snapshot changes only for the selected record', () => {
  const records = [{ id: 1, snapshotToken: 'same' }, { id: 2, snapshotToken: 'remote' }]
  assert.equal(model.recordSnapshotChanged(records, 1, 'same'), false)
  assert.equal(model.recordSnapshotChanged(records, 2, 'local'), true)
  assert.equal(model.recordSnapshotChanged(records, 3, 'local'), true)
  assert.equal(model.recordSnapshotChanged(records, 2, ''), false)
})

test('ticks a running Active Timer from the confirmed observation and never ticks paused time', () => {
  const observedAtMs = Date.parse('2026-09-01T15:00:00Z')
  assert.equal(model.elapsedSeconds({ elapsedSeconds: 120, running: true, observedAtMs }, observedAtMs + 4550), 124)
  assert.equal(model.elapsedSeconds({ elapsedSeconds: 120, running: false, observedAtMs }, observedAtMs + 4550), 120)
  assert.equal(model.elapsedSeconds({ elapsedSeconds: 120, running: true, observedAtMs }, observedAtMs - 1000), 120)
  assert.equal(model.formatDuration(3661), '01:01:01')
  assert.equal(model.formatHoursMinutes(3661), '01:01')
  assert.equal(model.formatHoursMinutes(59), '00:00')
})

test('parses explicit HH:MM and HH:MM:SS duration input', () => {
  assert.equal(model.parseDurationInput('10:00'), 36000)
  assert.equal(model.parseDurationInput('00:01:30'), 90)
  assert.equal(model.parseDurationInput('1:60'), null)
  assert.equal(model.parseDurationInput('90'), null)
})

test('filters projects and orders one day of entries chronologically', () => {
  const projects = [{ title: 'Website', clientName: 'Acme' }, { title: 'Internal', clientName: '' }]
  assert.deepEqual(model.searchProjects(projects, 'acme'), [projects[0]])
  const entries = [
    { id: 2, localDate: '2026-09-02', startedAt: '2026-09-02T15:00:00Z' },
    { id: 1, localDate: '2026-09-02', startedAt: '2026-09-02T14:00:00Z' },
    { id: 3, localDate: '2026-09-03', startedAt: '2026-09-03T14:00:00Z' }
  ]
  assert.deepEqual(model.entriesForDay(entries, '2026-09-02').map(entry => entry.id), [1, 2])
})

test('expands project services into explicit quick-start choices', () => {
  const project = { id: 4, title: 'Build', clientName: 'Acme', services: [{ id: 7, name: 'Design' }, { id: 8, name: 'Development' }] }
  const shortcuts = model.projectShortcuts([project])
  assert.deepEqual(shortcuts.map(item => [item.projectId, item.serviceId]), [[4, 7], [4, 8]])
  assert.deepEqual(model.searchShortcuts(shortcuts, 'development'), [shortcuts[1]])
})

test('orders Project Shortcuts by selected Active Timer then FreshBooks recency', () => {
  const projects = [
    { id: 1, title: 'Alpha', clientName: 'Client', active: true },
    { id: 2, title: 'Beta', clientName: 'Client', active: true },
    { id: 3, title: 'Archived', clientName: 'Client', archived: true },
    { id: 4, title: 'No history', clientName: 'Client', active: true }
  ]
  const entries = [
    { projectId: 1, startedAt: '2026-08-29T10:00:00Z' },
    { projectId: 2, startedAt: '2026-09-01T10:00:00Z' }
  ]
  assert.deepEqual(model.recentProjectOrder(projects, entries, 1).map(project => project.id), [1, 2, 4])
  assert.deepEqual(model.recentProjectOrder(projects, entries, '').map(project => project.id), [2, 1, 4])
})
