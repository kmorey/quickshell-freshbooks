'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Model = require('../TimeTrackingModel.js')
const FakeCliModel = require('../FakeCliModel.js')

function serviceFunctions(source) {
  const functions = []
  const pattern = /^  function ([A-Za-z_$][\w$]*)\s*\([^\n]*\)\s*\{/gm
  let match
  while ((match = pattern.exec(source)) !== null) {
    let index = source.indexOf('{', match.index)
    let depth = 0
    let quote = ''
    let escaped = false
    for (; index < source.length; index += 1) {
      const character = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = ''
        continue
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character
        continue
      }
      if (character === '{') depth += 1
      else if (character === '}' && --depth === 0) {
        functions.push({ name: match[1], source: source.slice(match.index + 2, index + 1) })
        pattern.lastIndex = index + 1
        break
      }
    }
  }
  return functions
}

function createFakeAdapter(script) {
  return {
    script: script.slice(),
    requests: [],
    pending: [],
    service: null,
    execute(requestId, request) {
      this.requests.push({
        intent: request.intent,
        argv: Array.from(request.argv),
        payload: { ...request.payload }
      })
      const consumed = FakeCliModel.consume(this.script, request)
      this.script = consumed.remaining
      this.pending.push({ requestId, result: consumed.result })
    },
    deliverNext() {
      if (this.pending.length === 0) return false
      const { requestId, result } = this.pending.shift()
      if (result.ok) this.service.finishRequest(requestId, result.data, null)
      else this.service.finishRequest(requestId, null, result.error)
      return true
    },
    flush() {
      while (this.deliverNext()) {}
    }
  }
}

function createService(script) {
  const stateData = {
    timerId: '',
    timerNote: '',
    timerDuration: '',
    timerSnapshotToken: '',
    timerNoteDirty: false,
    timerDurationDirty: false,
    entryDraft: {}
  }
  const adapter = createFakeAdapter(script)
  const service = {
    Model,
    Date,
    stateData,
    cacheData: { projects: [], recentEntries: [] },
    cliAdapter: adapter,
    timers: [],
    projects: [],
    entries: [],
    recentEntries: [],
    diagnostics: {
      version: '0.2.0',
      capabilities: ['projects', 'time-entries', 'timer-segments', 'timer-switch', 'snapshot-guards', 'local-calendar', 'bounded-history', 'popup-onboarding'],
      configured: true,
      authenticated: true,
      businessSelected: true
    },
    businesses: [],
    authorizationUrl: '',
    selectedTimerId: '',
    phase: 'ready',
    lastErrorCode: '',
    lastError: '',
    outcomeUnknown: false,
    snapshotStale: true,
    conflictPending: false,
    lastRefreshMs: 0,
    visibleConsumers: {},
    lastEntryFrom: '',
    lastEntryTo: '',
    _queue: [],
    _current: null,
    _requestSerial: 0,
    _refreshQueued: false,
    _conflictRequest: null,
    _draftConflict: false,
    _projectsConfirmed: false,
    _recentConfirmed: false,
    _unknownRefreshIntent: '',
    _unknownRequest: null,
    _unknownRefreshFrom: '',
    _unknownRefreshTo: '',
    _unknownOriginalFrom: '',
    _unknownOriginalTo: '',
    _draftFileReady: true,
    _draftResetPending: false,
    _fullRefreshRequested: false,
    _optimisticTimerActive: false,
    _optimisticTimer: null,
    _pendingCreatedEntryReconciliations: []
  }

  for (const name of ['draftTimerId', 'draftTimerNote', 'draftTimerDuration', 'draftTimerSnapshotToken', 'draftTimerNoteDirty', 'draftTimerDurationDirty', 'entryDraft']) {
    const key = name.replace(/^draftTimer/, 'timer').replace(/^entryDraft$/, 'entryDraft')
    Object.defineProperty(service, name, {
      enumerable: true,
      get: () => stateData[key],
      set: value => { stateData[key] = value }
    })
  }
  Object.defineProperties(service, {
    timerMode: { get: () => Model.timerMode(service.timers) },
    activeTimer: { get: () => service._optimisticTimerActive ? service._optimisticTimer : Model.selectedTimer(service.timers, service.selectedTimerId) },
    diagnosticsReady: { get: () => service.diagnosticsCompatible(service.diagnostics) }
  })

  const source = fs.readFileSync(path.join(__dirname, '..', 'Service.qml'), 'utf8')
  const functions = serviceFunctions(source)
  const names = functions.map(entry => entry.name)
  const factory = vm.runInNewContext(`(function () { with (this) {\n${functions.map(entry => entry.source).join('\n')}\nreturn { ${names.join(', ')} }\n} })`)
  Object.assign(service, factory.call(service))
  adapter.service = service
  return { service, adapter }
}

module.exports = { createService }
