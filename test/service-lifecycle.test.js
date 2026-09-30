'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createService } = require('./service-harness.js')

function timer(snapshotToken, running) {
  return {
    id: 'timer-42',
    projectId: 7,
    serviceId: 9,
    note: 'Authoritative note',
    running,
    elapsedSeconds: running ? 120 : 125,
    snapshotToken
  }
}

function editTimerNote(service, baselineToken) {
  service.draftTimerId = 'timer-42'
  service.draftTimerNote = 'Draft survives pause'
  service.draftTimerSnapshotToken = baselineToken
  service.draftTimerNoteDirty = true
}

test('unattended Service start, edit, pause, refresh, and log keeps the draft baseline authoritative', () => {
  const running = timer('T0', true)
  const paused = timer('T1', false)
  const logged = { id: 'entry-88', snapshotToken: 'E1' }
  const { service, adapter } = createService([
    { intent: 'start', data: running },
    { intent: 'refreshTimers', data: [running] },
    { intent: 'pause', data: paused },
    { intent: 'refreshTimers', data: [paused] },
    { intent: 'log', data: logged },
    { intent: 'refreshTimers', data: [] },
    { intent: 'refreshRecentEntries', data: [logged] },
    { intent: 'refreshEntries', data: [logged] }
  ])

  service.start(7, 9, 'Authoritative note')
  adapter.flush()
  editTimerNote(service, 'T0')
  service.pause()
  adapter.flush()

  assert.equal(service.conflictPending, false)
  assert.notEqual(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.draftTimerNote, 'Draft survives pause')
  assert.equal(service.draftTimerNoteDirty, true)
  assert.equal(service.draftTimerSnapshotToken, 'T1')

  service.logTimer()
  adapter.flush()
  const logRequest = adapter.requests.find(request => request.intent === 'log')
  assert.deepEqual(logRequest.argv, ['timer', 'log', '--id', 'timer-42', '--snapshot', 'T1'])
  assert.equal(service.activeTimer, null)
  assert.equal(service.draftTimerId, '')
  assert.equal(service.draftTimerNoteDirty, false)
  assert.equal(adapter.script.length, 0)
})

test('a refresh token not produced by the local pause still conflicts', () => {
  const running = timer('T0', true)
  const paused = timer('T1', false)
  const remotelyChanged = timer('T2', false)
  const { service, adapter } = createService([
    { intent: 'start', data: running },
    { intent: 'refreshTimers', data: [running] },
    { intent: 'pause', data: paused },
    { intent: 'refreshTimers', data: [remotelyChanged] }
  ])

  service.start(7, 9, 'Authoritative note')
  adapter.flush()
  editTimerNote(service, 'T0')
  service.pause()
  adapter.flush()

  assert.equal(service.conflictPending, true)
  assert.equal(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.draftTimerNote, 'Draft survives pause')
  assert.equal(service.draftTimerSnapshotToken, 'T1')
  assert.equal(adapter.script.length, 0)
})

test('an empty local mutation token preserves the draft baseline and a later changed token conflicts', () => {
  const running = timer('T0', true)
  const pausedWithoutToken = timer('', false)
  const remotelyChanged = timer('T2', false)
  const { service, adapter } = createService([
    { intent: 'start', data: running },
    { intent: 'refreshTimers', data: [running] },
    { intent: 'pause', data: pausedWithoutToken },
    { intent: 'refreshTimers', data: [remotelyChanged] }
  ])

  service.start(7, 9, 'Authoritative note')
  adapter.flush()
  editTimerNote(service, 'T0')
  service.pause()
  adapter.flush()

  assert.equal(service.conflictPending, true)
  assert.equal(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.draftTimerNote, 'Draft survives pause')
  assert.equal(service.draftTimerSnapshotToken, 'T0')
  assert.equal(adapter.script.length, 0)
})

function entry(snapshotToken, changes = {}) {
  return {
    id: 'entry-88',
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25',
    startedAt: '2026-09-25T09:00:00Z',
    snapshotToken,
    ...changes
  }
}

function dirtyEntryDraft(service, snapshotToken) {
  service.saveEntryDraft({
    mode: 'edit',
    entryId: 'entry-88',
    projectId: 7,
    serviceId: 9,
    snapshotToken,
    note: 'Locally edited after create',
    duration: '1:00',
    selectedDate: '2026-09-25',
    entryDate: '2026-09-25',
    originalDate: '2026-09-25',
    dirty: true
  })
}

test('a dirty edit opened before a created Time Entry reconciliation rebases to its new snapshot', () => {
  const created = entry('C1')
  const reconciled = entry('C2')
  const { service, adapter } = createService([
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: created },
    { intent: 'refreshRecentEntries', data: [created] },
    { intent: 'refreshEntries', data: [reconciled] },
    { intent: 'updateEntry', data: entry('C3', { note: 'Locally edited after create' }) },
  ])

  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25'
  })
  assert.equal(adapter.deliverNext(), true)
  assert.equal(adapter.deliverNext(), true)

  dirtyEntryDraft(service, 'C1')
  assert.equal(adapter.deliverNext(), true)
  assert.equal(adapter.deliverNext(), true)

  assert.equal(service.conflictPending, false)
  assert.notEqual(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.entryDraft.snapshotToken, 'C2')
  assert.equal(service.entryDraft.note, 'Locally edited after create')
  service.updateEntry('entry-88', {
    durationSeconds: 3600,
    projectId: 7,
    serviceId: 9,
    note: 'Locally edited after create'
  }, 'C1')
  const updateRequest = adapter.requests.find(request => request.intent === 'updateEntry')
  assert.deepEqual(updateRequest.argv, [
    'time', 'update', 'entry-88',
    '--duration', '3600',
    '--project', '7',
    '--service', '9',
    '--note', 'Locally edited after create',
    '--snapshot', 'C2'
  ])
  assert.equal(adapter.script.length, 0)
})

test('stale Panel persistence cannot downgrade a rebased dirty Time Entry baseline', () => {
  const created = entry('C1')
  const { service, adapter } = createService([
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: created },
    { intent: 'refreshRecentEntries', data: [created] },
    { intent: 'refreshEntries', data: [entry('C2')] },
    { intent: 'updateEntry', data: entry('C3', { note: 'Typed after rebase' }) }
  ])

  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25'
  })
  adapter.deliverNext()
  adapter.deliverNext()
  dirtyEntryDraft(service, 'C1')
  adapter.deliverNext()
  adapter.deliverNext()

  service.saveEntryDraft({
    ...service.entryDraft,
    snapshotToken: 'C1',
    note: 'Typed after rebase'
  })
  assert.equal(service.entryDraft.snapshotToken, 'C2')
  assert.equal(service.entryDraft.note, 'Typed after rebase')

  service.updateEntry('entry-88', {
    durationSeconds: 3600,
    projectId: 7,
    serviceId: 9,
    note: 'Typed after rebase'
  }, 'C1')
  const updateRequest = adapter.requests.find(request => request.intent === 'updateEntry')
  assert.deepEqual(updateRequest.argv.slice(-2), ['--snapshot', 'C2'])
  assert.equal(adapter.script.length, 0)
})

test('an update queued behind creation reconciliation resolves its guard at dispatch', () => {
  const created = entry('C1')
  const { service, adapter } = createService([
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: created },
    { intent: 'refreshRecentEntries', data: [created] },
    { intent: 'refreshEntries', data: [entry('C2')] },
    { intent: 'updateEntry', data: entry('C3', { note: 'Queued save' }) }
  ])

  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25'
  })
  adapter.deliverNext()
  adapter.deliverNext()
  dirtyEntryDraft(service, 'C1')
  adapter.deliverNext()

  service.updateEntry('entry-88', {
    durationSeconds: 3600,
    projectId: 7,
    serviceId: 9,
    note: 'Queued save'
  }, 'C1')
  assert.equal(adapter.requests.some(request => request.intent === 'updateEntry'), false)

  adapter.deliverNext()
  const updateRequest = adapter.requests.find(request => request.intent === 'updateEntry')
  assert.deepEqual(updateRequest.argv.slice(-2), ['--snapshot', 'C2'])
  assert.equal(service.conflictPending, false)
  assert.equal(adapter.script.length, 0)
})

test('dispatch-time entry guard rewriting preserves a note equal to the snapshot option', () => {
  const created = entry('C1')
  const { service, adapter } = createService([
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: created },
    { intent: 'refreshRecentEntries', data: [created] },
    { intent: 'refreshEntries', data: [entry('C2')] },
    { intent: 'updateEntry', data: entry('C3', { note: '--snapshot' }) }
  ])

  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25'
  })
  adapter.deliverNext()
  adapter.deliverNext()
  dirtyEntryDraft(service, 'C1')
  adapter.deliverNext()

  service.updateEntry('entry-88', {
    durationSeconds: 3600,
    projectId: 7,
    serviceId: 9,
    note: '--snapshot'
  }, 'C1')
  assert.equal(adapter.requests.some(request => request.intent === 'updateEntry'), false)

  adapter.deliverNext()
  const updateRequest = adapter.requests.find(request => request.intent === 'updateEntry')
  assert.deepEqual(updateRequest.argv, [
    'time', 'update', 'entry-88',
    '--duration', '3600',
    '--project', '7',
    '--service', '9',
    '--note', '--snapshot',
    '--snapshot', 'C2'
  ])
  assert.equal(adapter.script.length, 0)
})

test('a failed designated creation reconciliation cannot authorize a later token', () => {
  const created = entry('C1')
  const { service, adapter } = createService([
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: created },
    { intent: 'refreshRecentEntries', data: [created] },
    {
      intent: 'refreshEntries',
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'Designated read failed' }
    },
    { intent: 'refreshEntries', data: [entry('C3')] }
  ])

  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25'
  })
  adapter.deliverNext()
  adapter.deliverNext()
  dirtyEntryDraft(service, 'C1')
  adapter.deliverNext()
  adapter.deliverNext()

  service.refreshEntries()
  adapter.deliverNext()

  assert.equal(service.conflictPending, true)
  assert.equal(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.entryDraft.snapshotToken, 'C1')
  assert.equal(adapter.script.length, 0)
})

test('one designated read reconciles every create completed before it dispatches', () => {
  const firstCreated = entry('C1')
  const secondCreated = entry('D1', { id: 'entry-99', note: 'Second created in plugin' })
  const { service, adapter } = createService([
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: firstCreated },
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: secondCreated },
    { intent: 'refreshRecentEntries', data: [firstCreated, secondCreated] },
    { intent: 'refreshEntries', data: [entry('C2'), entry('D2', { id: 'entry-99', note: 'Second created in plugin' })] }
  ])

  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25'
  })
  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Second created in plugin',
    localDate: '2026-09-25'
  })
  adapter.deliverNext()
  adapter.deliverNext()
  adapter.deliverNext()
  service.refreshEntries('2026-09-01', '2026-09-30')
  adapter.deliverNext()
  dirtyEntryDraft(service, 'C1')
  adapter.deliverNext()
  adapter.deliverNext()
  const reconciliationRequest = adapter.requests.find(request => request.intent === 'refreshEntries')
  assert.deepEqual(
    Array.from(reconciliationRequest.payload.createdEntryReconciliations, item => String(item.id)).sort(),
    ['entry-88', 'entry-99']
  )

  assert.equal(service.conflictPending, false)
  assert.notEqual(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.entryDraft.snapshotToken, 'C2')
  assert.equal(adapter.script.length, 0)
})

function reconcileCreatedEntry(reconciled, extraScript = []) {
  const created = entry('C1')
  const { service, adapter } = createService([
    { intent: 'prepareCreateEntry', data: [] },
    { intent: 'createEntry', data: created },
    { intent: 'refreshRecentEntries', data: [created] },
    { intent: 'refreshEntries', data: reconciled },
    ...extraScript
  ])
  service.createEntry({
    projectId: 7,
    clientId: 11,
    serviceId: 9,
    durationSeconds: 3600,
    note: 'Created in plugin',
    localDate: '2026-09-25'
  })
  adapter.deliverNext()
  adapter.deliverNext()
  dirtyEntryDraft(service, 'C1')
  adapter.deliverNext()
  adapter.deliverNext()
  return { service, adapter }
}

test('an unchanged created Time Entry with the same snapshot remains clean', () => {
  const { service, adapter } = reconcileCreatedEntry([entry('C1')])

  assert.equal(service.conflictPending, false)
  assert.notEqual(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.entryDraft.snapshotToken, 'C1')
  assert.equal(adapter.script.length, 0)
})

test('a missing created Time Entry still conflicts with its dirty edit', () => {
  const { service, adapter } = reconcileCreatedEntry([])

  assert.equal(service.conflictPending, true)
  assert.equal(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.entryDraft.snapshotToken, 'C1')
  assert.equal(adapter.script.length, 0)
})

test('changed authoritative fields on a created Time Entry still conflict', () => {
  const { service, adapter } = reconcileCreatedEntry([
    entry('C2', { durationSeconds: 5400 })
  ])

  assert.equal(service.conflictPending, true)
  assert.equal(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.entryDraft.snapshotToken, 'C1')
  assert.equal(adapter.script.length, 0)
})

test('a later snapshot change conflicts after the created Time Entry reconciliation is consumed', () => {
  const { service, adapter } = reconcileCreatedEntry(
    [entry('C2')],
    [{ intent: 'refreshEntries', data: [entry('C3')] }]
  )

  assert.equal(service.conflictPending, false)
  assert.equal(service.entryDraft.snapshotToken, 'C2')

  service.refreshEntries()
  adapter.deliverNext()

  assert.equal(service.conflictPending, true)
  assert.equal(service.lastErrorCode, 'REMOTE_CHANGED')
  assert.equal(service.entryDraft.snapshotToken, 'C2')
  assert.equal(adapter.script.length, 0)
})

test('Apply mine stays unguarded after a rebased entry later conflicts', () => {
  const { service, adapter } = reconcileCreatedEntry(
    [entry('C2')],
    [
      { intent: 'refreshEntries', data: [entry('C3')] },
      { intent: 'updateEntry', data: entry('C4', { note: '--snapshot' }) }
    ]
  )

  assert.equal(service.entryDraft.snapshotToken, 'C2')
  service.saveEntryDraft({ ...service.entryDraft, note: '--snapshot' })
  service.refreshEntries()
  adapter.deliverNext()
  assert.equal(service.conflictPending, true)

  service.resolveConflictApplyMine()

  const updateRequests = adapter.requests.filter(request => request.intent === 'updateEntry')
  assert.equal(updateRequests.length, 1)
  assert.deepEqual(updateRequests[0].argv, [
    'time', 'update', 'entry-88',
    '--duration', '3600',
    '--project', '7',
    '--service', '9',
    '--note', '--snapshot'
  ])
  assert.equal(service.conflictPending, false)
  assert.equal(adapter.script.length, 0)
})
