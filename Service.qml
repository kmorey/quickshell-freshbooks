import QtQuick
import Quickshell
import "TimeTrackingModel.js" as Model

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property var barWidgetRegistry: null
  property string omarchyPath: ""

  // The adapter is the single external seam. Tests and prototypes replace it
  // with FakeCliAdapter without changing any timer state or intent code.
  property var cliAdapter: productionCli
  property var timers: []
  property var projects: []
  property var entries: []
  property string selectedTimerId: ""
  property string phase: "starting"
  property string lastErrorCode: ""
  property string lastError: ""
  property bool outcomeUnknown: false
  property bool snapshotStale: true
  property bool conflictPending: false
  property double lastRefreshMs: 0
  property var visibleConsumers: ({})
  property string lastEntryFrom: ""
  property string lastEntryTo: ""

  readonly property string timerMode: Model.timerMode(timers)
  readonly property var activeTimer: Model.selectedTimer(timers, selectedTimerId)
  readonly property var state: Model.stateProjection({ timers: timers, projects: projects, entries: entries }, selectedTimerId)
  readonly property bool busy: _current !== null
  readonly property bool hasVisibleConsumers: Object.keys(visibleConsumers).length > 0

  property var _queue: []
  property var _current: null
  property int _requestSerial: 0
  property bool _refreshQueued: false
  property var _conflictRequest: null

  function withSnapshot(argv, record) {
    var result = argv.slice()
    if (record && String(record.snapshotToken || "") !== "") result.push("--snapshot", String(record.snapshotToken))
    return result
  }

  function useAdapter(adapter) {
    if (_current !== null) return false
    cliAdapter = adapter || productionCli
    return true
  }

  function registerVisibleConsumer(consumerId) {
    var id = String(consumerId || "")
    if (id === "") return
    var next = {}
    for (var key in visibleConsumers) next[key] = visibleConsumers[key]
    next[id] = true
    visibleConsumers = next
    refresh()
  }

  function unregisterVisibleConsumer(consumerId) {
    var id = String(consumerId || "")
    var next = {}
    for (var key in visibleConsumers) if (key !== id) next[key] = visibleConsumers[key]
    visibleConsumers = next
  }

  function selectTimer(timerId) {
    var selected = Model.selectedTimer(timers, timerId)
    selectedTimerId = selected ? String(selected.id) : ""
  }

  function clearError() {
    lastErrorCode = ""
    lastError = ""
    outcomeUnknown = false
  }

  function refresh() {
    if (_refreshQueued || (_current && _current.intent === "refreshTimers")) return
    _refreshQueued = true
    enqueue("refreshTimers", ["timer", "status"], {}, false)
  }

  function refreshProjects() {
    enqueue("refreshProjects", ["projects", "list"], {}, false)
  }

  function refreshEntries(fromDate, toDate) {
    lastEntryFrom = String(fromDate || lastEntryFrom || "")
    lastEntryTo = String(toDate || lastEntryTo || "")
    var argv = ["time", "list"]
    if (lastEntryFrom !== "") argv.push("--from", lastEntryFrom)
    if (lastEntryTo !== "") argv.push("--to", lastEntryTo)
    enqueue("refreshEntries", argv, { fromDate: lastEntryFrom, toDate: lastEntryTo }, false)
  }

  function refreshAll(fromDate, toDate) {
    refresh()
    refreshProjects()
    refreshEntries(fromDate, toDate)
  }

  function start(projectId, serviceId, note) {
    var argv = ["timer", "start", "--project", String(projectId)]
    if (serviceId !== undefined && serviceId !== null) argv.push("--service", String(serviceId))
    if (String(note || "") !== "") argv.push("--note", String(note))
    enqueue("start", argv, { projectId: projectId }, true)
  }

  function pause() {
    if (!activeTimer) return
    enqueue("pause", withSnapshot(["timer", "pause", "--id", String(activeTimer.id)], activeTimer), { timerId: activeTimer.id }, true)
  }

  function resume() {
    if (!activeTimer) return
    enqueue("resume", withSnapshot(["timer", "resume", "--id", String(activeTimer.id)], activeTimer), { timerId: activeTimer.id }, true)
  }

  function correctDuration(seconds) {
    if (!activeTimer) return
    enqueue("correctDuration", withSnapshot(["timer", "correct", "--id", String(activeTimer.id), "--duration", String(Math.max(0, Math.round(Number(seconds) || 0)))], activeTimer), { timerId: activeTimer.id }, true)
  }

  function updateTimerNote(note) {
    if (!activeTimer) return
    enqueue("updateTimerNote", withSnapshot(["timer", "update", "--id", String(activeTimer.id), "--note", String(note || "")], activeTimer), { timerId: activeTimer.id }, true)
  }

  function logTimer() {
    if (!activeTimer) return
    enqueue("log", withSnapshot(["timer", "log", "--id", String(activeTimer.id)], activeTimer), { timerId: activeTimer.id }, true)
  }

  function switchTimer(projectId, serviceId) {
    if (timerMode === "multiple" || (timerMode === "single" && !activeTimer)) return
    var argv = ["timer", "switch", "--project", String(projectId)]
    if (serviceId !== undefined && serviceId !== null) argv.push("--service", String(serviceId))
    if (activeTimer) argv.push("--id", String(activeTimer.id))
    argv = withSnapshot(argv, activeTimer)
    enqueue("switch", argv, { projectId: projectId }, true)
  }

  function appendFieldArguments(argv, fields) {
    var values = fields || {}
    var options = [
      ["durationSeconds", "--duration"],
      ["startedAt", "--started-at"],
      ["projectId", "--project"],
      ["clientId", "--client"],
      ["serviceId", "--service"],
      ["note", "--note"]
    ]
    for (var i = 0; i < options.length; i++) {
      var propertyName = options[i][0]
      if (values[propertyName] === undefined || values[propertyName] === null) continue
      argv.push(options[i][1], String(values[propertyName]))
    }
    return argv
  }

  function createEntry(fields) {
    enqueue("createEntry", appendFieldArguments(["time", "add"], fields), fields || {}, true)
  }

  function updateEntry(entryId, fields, snapshotToken) {
    var argv = appendFieldArguments(["time", "update", String(entryId)], fields)
    if (String(snapshotToken || "") !== "") argv.push("--snapshot", String(snapshotToken))
    enqueue("updateEntry", argv, fields || {}, true)
  }

  function deleteEntry(entryId) {
    enqueue("deleteEntry", ["time", "delete", String(entryId), "--yes"], { entryId: entryId }, true)
  }

  function enqueue(intent, argv, payload, mutation) {
    _requestSerial += 1
    var next = _queue.slice()
    next.push({
      id: "request-" + _requestSerial,
      intent: intent,
      argv: argv.slice(),
      payload: payload || {},
      mutation: mutation === true
    })
    _queue = next
    pump()
  }

  function resolveConflictReload() {
    conflictPending = false
    _conflictRequest = null
    clearError()
    refreshAll(lastEntryFrom, lastEntryTo)
  }

  function resolveConflictApplyMine() {
    if (!_conflictRequest) return
    var request = _conflictRequest
    var argv = []
    for (var i = 0; i < request.argv.length; i++) {
      if (request.argv[i] === "--snapshot") { i += 1; continue }
      argv.push(request.argv[i])
    }
    conflictPending = false
    _conflictRequest = null
    clearError()
    enqueue(request.intent, argv, request.payload, true)
  }

  function pump() {
    if (_current !== null || _queue.length === 0 || !cliAdapter) return
    var next = _queue.slice()
    _current = next.shift()
    _queue = next
    phase = _current.mutation ? "mutating" : "refreshing"
    cliAdapter.execute(_current.id, _current)
  }

  function adoptTimerData(data) {
    var receivedAt = Date.now()
    var candidates = Model.timerCandidates(data)
    var anchored = []
    for (var i = 0; i < candidates.length; i++) {
      var source = candidates[i] || {}
      var timer = {}
      for (var key in source) timer[key] = source[key]
      if (timer.observedAtMs === undefined) timer.observedAtMs = receivedAt
      anchored.push(timer)
    }
    timers = anchored
    if (timers.length === 1) selectedTimerId = String(timers[0].id)
    else if (!Model.selectedTimer(timers, selectedTimerId)) selectedTimerId = ""
    snapshotStale = false
    lastRefreshMs = Date.now()
  }

  function finishRequest(requestId, data, error) {
    if (!_current || String(_current.id) !== String(requestId)) return
    var completed = _current
    var reconcile = false
    _current = null
    if (completed.intent === "refreshTimers") _refreshQueued = false

    if (error) {
      phase = "error"
      lastErrorCode = String(error.code || "UNKNOWN_ERROR")
      lastError = String(error.message || "FreshBooks operation failed")
      outcomeUnknown = error.outcomeUnknown === true
      if (lastErrorCode === "REMOTE_CHANGED") {
        conflictPending = true
        _conflictRequest = completed
        refresh()
      }
    } else {
      phase = "ready"
      if (!conflictPending) clearError()
      if (completed.intent === "refreshTimers") adoptTimerData(data)
      else if (completed.intent === "refreshProjects") projects = Array.isArray(data) ? data : []
      else if (completed.intent === "refreshEntries") entries = Array.isArray(data) ? data : []
      else reconcile = true
    }
    if (phase !== "error") phase = conflictPending ? "conflict" : (timerMode === "multiple" ? "ambiguous" : "ready")
    // Mutation responses are authoritative, but their exact normalized shape
    // belongs to the CLI contract. Reconcile the whole timer set before the
    // next view treats it as current.
    if (reconcile) refreshAll(lastEntryFrom, lastEntryTo)
    else pump()
  }

  Connections {
    target: root.cliAdapter
    function onSucceeded(requestId, data) { root.finishRequest(requestId, data, null) }
    function onFailed(requestId, error) { root.finishRequest(requestId, null, error) }
  }

  CliAdapter { id: productionCli }

  Timer {
    interval: 15000
    repeat: true
    running: root.hasVisibleConsumers
    onTriggered: root.refresh()
  }

  Component.onCompleted: refresh()
}
