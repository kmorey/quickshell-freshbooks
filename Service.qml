import QtQuick
import Quickshell
import Quickshell.Io
import "TimeTrackingModel.js" as Model

Item {
  id: root

  property alias draftTimerId: stateData.timerId
  property alias draftTimerNote: stateData.timerNote
  property alias draftTimerDuration: stateData.timerDuration
  property alias draftTimerSnapshotToken: stateData.timerSnapshotToken
  property alias draftTimerNoteDirty: stateData.timerNoteDirty
  property alias draftTimerDurationDirty: stateData.timerDurationDirty
  property alias entryDraft: stateData.entryDraft

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
  property var recentEntries: []
  property var diagnostics: ({})
  property var businesses: []
  property string authorizationUrl: ""
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
  readonly property bool diagnosticsReady: diagnosticsCompatible(diagnostics)

  property var _queue: []
  property var _current: null
  property int _requestSerial: 0
  property bool _refreshQueued: false
  property var _conflictRequest: null
  property bool _draftConflict: false
  property bool _projectsConfirmed: false
  property bool _recentConfirmed: false
  property string _unknownRefreshIntent: ""
  property var _unknownRequest: null
  property string _unknownRefreshFrom: ""
  property string _unknownRefreshTo: ""
  property string _unknownOriginalFrom: ""
  property string _unknownOriginalTo: ""
  property bool _draftFileReady: false
  property bool _draftResetPending: false
  property bool _fullRefreshRequested: false

  function saveEntryDraft(draft) { stateData.entryDraft = draft || ({}) }
  function diagnosticsCompatible(value) {
    var data = value || {}
    var parts = String(data.version || "").split(".")
    if (Number(parts[0] || 0) !== 0 || Number(parts[1] || 0) < 2) return false
    if (!Array.isArray(data.capabilities)) return false
    var required = ["projects", "time-entries", "timer-segments", "timer-switch", "snapshot-guards", "local-calendar", "bounded-history", "popup-onboarding"]
    for (var i = 0; i < required.length; i++) if (data.capabilities.indexOf(required[i]) === -1) return false
    return true
  }
  function clearEntryDraft() { stateData.entryDraft = ({}) }
  function clearTimerDraft() {
    stateData.timerId = ""
    stateData.timerNote = ""
    stateData.timerDuration = ""
    stateData.timerSnapshotToken = ""
    stateData.timerNoteDirty = false
    stateData.timerDurationDirty = false
  }
  function clearTimerNoteDraft() {
    stateData.timerNote = ""
    stateData.timerNoteDirty = false
  }
  function clearTimerDurationDraft() {
    stateData.timerDuration = ""
    stateData.timerDurationDirty = false
  }

  function setupReady() {
    return diagnosticsReady
      && diagnostics.configured === true
      && diagnostics.authenticated === true
      && diagnostics.businessSelected === true
  }

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
    _unknownRefreshIntent = ""
    _unknownRequest = null
    _unknownRefreshFrom = ""
    _unknownRefreshTo = ""
  }

  function refresh() {
    if (!setupReady()) return
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

  function refreshRecentEntries() {
    enqueue("refreshRecentEntries", ["time", "list", "--limit", "200"], {}, false)
  }

  function refreshAll(fromDate, toDate) {
    lastEntryFrom = String(fromDate || lastEntryFrom || "")
    lastEntryTo = String(toDate || lastEntryTo || "")
    _fullRefreshRequested = true
    refreshDiagnostics()
    if (!setupReady()) return
    _fullRefreshRequested = false
    refreshOperationalData()
  }

  function refreshOperationalData() {
    refresh()
    refreshProjects()
    refreshRecentEntries()
    refreshEntries(lastEntryFrom, lastEntryTo)
  }

  function refreshDiagnostics() {
    enqueue("refreshDiagnostics", ["diagnostics", "status"], {}, false)
  }

  function configureAuth(clientId, clientSecret, redirectUri) {
    if (String(clientId || "") === "" || String(clientSecret || "") === "" || String(redirectUri || "") === "") return false
    authorizationUrl = ""
    return enqueue("configureAuth", [
      "auth", "configure",
      "--client-id", String(clientId),
      "--redirect-uri", String(redirectUri),
      "--client-secret-stdin"
    ], {}, false, String(clientSecret))
  }

  function requestAuthorizationUrl() {
    authorizationUrl = ""
    return enqueue("requestAuthorizationUrl", ["auth", "url"], {}, false)
  }

  function completeAuthentication(codeOrUrl) {
    if (String(codeOrUrl || "") === "") return false
    return enqueue("completeAuthentication", ["auth", "login", "--code-stdin"], {}, false, String(codeOrUrl))
  }

  function refreshBusinesses() {
    return enqueue("refreshBusinesses", ["business", "list"], {}, false)
  }

  function selectBusiness(businessId) {
    if (String(businessId || "") === "") return false
    return enqueue("selectBusiness", ["business", "use", String(businessId)], {}, false)
  }

  function retryUnknownRefresh() {
    if (!outcomeUnknown) return false
    if (_unknownRefreshIntent === "refreshEntries") {
      var argv = ["time", "list"]
      if (_unknownRefreshFrom !== "") argv.push("--from", _unknownRefreshFrom)
      if (_unknownRefreshTo !== "") argv.push("--to", _unknownRefreshTo)
      return enqueueNext("refreshEntries", argv, { fromDate: _unknownRefreshFrom, toDate: _unknownRefreshTo }, false)
    }
    if (_unknownRefreshIntent === "refreshTimers") {
      refresh()
      return true
    }
    return false
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
      ["localDate", "--date"],
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
    var payload = {}
    var values = fields || {}
    for (var key in values) payload[key] = values[key]
    var targetDate = String(payload.localDate || "")
    // Establish a baseline for the exact target day before creating. If the
    // later write has an unknown outcome, only an ID absent from this baseline
    // can prove that FreshBooks accepted it.
    enqueue("prepareCreateEntry", ["time", "list", "--from", targetDate, "--to", targetDate], payload, false)
  }

  function updateEntry(entryId, fields, snapshotToken) {
    var argv = appendFieldArguments(["time", "update", String(entryId)], fields)
    if (String(snapshotToken || "") !== "") argv.push("--snapshot", String(snapshotToken))
    enqueue("updateEntry", argv, fields || {}, true)
  }

  function deleteEntry(entryId, snapshotToken) {
    var argv = ["time", "delete", String(entryId), "--yes"]
    if (String(snapshotToken || "") !== "") argv.push("--snapshot", String(snapshotToken))
    enqueue("deleteEntry", argv, { entryId: entryId }, true)
  }

  function enqueue(intent, argv, payload, mutation, stdin) {
    if (mutation === true && (outcomeUnknown || conflictPending)) return false
    _requestSerial += 1
    var next = _queue.slice()
    next.push({
      id: "request-" + _requestSerial,
      intent: intent,
      argv: argv.slice(),
      payload: payload || {},
      mutation: mutation === true,
      stdin: stdin === undefined ? undefined : String(stdin)
    })
    _queue = next
    pump()
    return true
  }

  function enqueueNext(intent, argv, payload, mutation) {
    if (mutation === true && (outcomeUnknown || conflictPending)) return false
    _requestSerial += 1
    var next = _queue.slice()
    next.unshift({
      id: "request-" + _requestSerial,
      intent: intent,
      argv: argv.slice(),
      payload: payload || {},
      mutation: mutation === true
    })
    _queue = next
    pump()
    return true
  }

  function resolveConflictReload() {
    var requestIntent = _conflictRequest ? String(_conflictRequest.intent || "") : ""
    if (_draftConflict || requestIntent.indexOf("Timer") !== -1 || requestIntent === "correctDuration") clearTimerDraft()
    else if (requestIntent.indexOf("Entry") !== -1) clearEntryDraft()
    conflictPending = false
    _draftConflict = false
    _conflictRequest = null
    clearError()
    refreshAll(lastEntryFrom, lastEntryTo)
  }

  function resolveConflictApplyMine() {
    if (_draftConflict && activeTimer) {
      var noteDirty = draftTimerNoteDirty
      var durationDirty = draftTimerDurationDirty
      var note = draftTimerNote
      var duration = Model.parseDurationInput(draftTimerDuration)
      conflictPending = false
      _draftConflict = false
      _conflictRequest = null
      clearError()
      if (noteDirty) enqueue("updateTimerNote", ["timer", "update", "--id", String(activeTimer.id), "--note", String(note)], { timerId: activeTimer.id }, true)
      if (durationDirty && duration !== null) enqueue("correctDuration", ["timer", "correct", "--id", String(activeTimer.id), "--duration", String(duration)], { timerId: activeTimer.id }, true)
      return
    }
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
    if (_current.stdin !== undefined) _current.stdin = ""
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
    var hasDirtyDraft = draftTimerNoteDirty || draftTimerDurationDirty
    if (hasDirtyDraft && Model.recordSnapshotChanged(anchored, draftTimerId, draftTimerSnapshotToken)) {
      conflictPending = true
      _draftConflict = true
      lastErrorCode = "REMOTE_CHANGED"
      lastError = "FreshBooks changed this timer while you were editing. Reload it or apply your draft."
    }
    timers = anchored
    if (timers.length === 1) selectedTimerId = String(timers[0].id)
    else if (!Model.selectedTimer(timers, selectedTimerId)) selectedTimerId = ""
    snapshotStale = false
    lastRefreshMs = Date.now()
  }

  function adoptEntryData(data) {
    var received = Array.isArray(data) ? data : []
    var draft = entryDraft || {}
    var storedMode = String(draft.mode || "")
    var mode = storedMode === "new" ? "create" : (storedMode === "create" || storedMode === "edit" ? storedMode : "edit")
    var entryId = String(draft.entryId || (storedMode !== "edit" && storedMode !== "create" && storedMode !== "new" ? storedMode : ""))
    if (mode === "edit" && entryId !== "" && draft.dirty === true
        && Model.recordSnapshotChanged(received, entryId, draft.snapshotToken)) {
      var fields = {
        durationSeconds: Model.parseDurationInput(String(draft.duration || "")),
        projectId: draft.projectId,
        serviceId: draft.serviceId,
        note: draft.note
      }
      var draftDate = String(draft.entryDate || draft.selectedDate || "")
      if (draftDate !== String(draft.originalDate || draftDate)) fields.localDate = draftDate
      var argv = appendFieldArguments(["time", "update", entryId], fields)
      argv.push("--snapshot", String(draft.snapshotToken))
      conflictPending = true
      _draftConflict = false
      _conflictRequest = { intent: "updateEntry", argv: argv, payload: fields, mutation: true }
      lastErrorCode = "REMOTE_CHANGED"
      lastError = "FreshBooks changed or removed this entry while you were editing. Reload it or apply your draft."
    }
    entries = received
  }

  function entryMatchesFields(entry, fields) {
    var values = fields || {}
    if (values.projectId !== undefined && String(entry.projectId) !== String(values.projectId)) return false
    if (values.serviceId !== undefined && String(entry.serviceId) !== String(values.serviceId)) return false
    if (values.durationSeconds !== undefined && Number(entry.durationSeconds) !== Number(values.durationSeconds)) return false
    if (values.note !== undefined && String(entry.note || "") !== String(values.note || "")) return false
    if (values.localDate !== undefined && String(entry.localDate) !== String(values.localDate)) return false
    return true
  }

  function reconcileUnknownEntry(data) {
    var request = _unknownRequest
    if (!request) return
    var received = Array.isArray(data) ? data : []
    if (request.intent === "createEntry") {
      if (String(request.payload.knownEntryDate || "") !== String(request.payload.localDate || "")) return
      var known = request.payload.knownEntryIds || []
      for (var i = 0; i < received.length; i++) {
        if (known.indexOf(String(received[i].id)) === -1 && entryMatchesFields(received[i], request.payload)) {
          clearEntryDraft()
          break
        }
      }
    } else if (request.intent === "updateEntry") {
      for (var j = 0; j < received.length; j++) {
        if (String(received[j].id) === String(request.argv[2]) && entryMatchesFields(received[j], request.payload)) {
          clearEntryDraft()
          break
        }
      }
    } else if (request.intent === "deleteEntry") {
      var found = false
      for (var k = 0; k < received.length; k++) if (String(received[k].id) === String(request.payload.entryId)) found = true
      if (!found) clearEntryDraft()
    }
  }

  function finishRequest(requestId, data, error) {
    if (!_current || String(_current.id) !== String(requestId)) return
    var completed = _current
    var reconcile = false
    var followupCreate = null
    var followupEntryRead = null
    _current = null
    if (completed.intent === "refreshTimers") _refreshQueued = false

    if (error) {
      var unresolvedOutcome = outcomeUnknown
      phase = "error"
      lastErrorCode = String(error.code || "UNKNOWN_ERROR")
      lastError = String(error.message || "FreshBooks operation failed")
      outcomeUnknown = error.outcomeUnknown === true || (completed.intent === _unknownRefreshIntent && unresolvedOutcome)
      if (lastErrorCode === "REMOTE_CHANGED") {
        conflictPending = true
        _draftConflict = false
        _conflictRequest = completed
        refresh()
      }
      if (lastErrorCode === "TIMER_SWITCH_PARTIAL") refreshAll(lastEntryFrom, lastEntryTo)
      if (error.outcomeUnknown === true) {
        _unknownRefreshIntent = completed.intent.indexOf("Entry") !== -1 ? "refreshEntries" : "refreshTimers"
        _unknownRequest = completed
        _unknownOriginalFrom = lastEntryFrom
        _unknownOriginalTo = lastEntryTo
        if (_unknownRefreshIntent === "refreshEntries") {
          var recoveryDate = completed.intent === "createEntry" ? String(completed.payload.localDate || "") : ""
          _unknownRefreshFrom = recoveryDate !== "" ? recoveryDate : lastEntryFrom
          _unknownRefreshTo = recoveryDate !== "" ? recoveryDate : lastEntryTo
          var recoveryArgv = ["time", "list"]
          if (_unknownRefreshFrom !== "") recoveryArgv.push("--from", _unknownRefreshFrom)
          if (_unknownRefreshTo !== "") recoveryArgv.push("--to", _unknownRefreshTo)
          followupEntryRead = {
            argv: recoveryArgv,
            payload: { fromDate: _unknownRefreshFrom, toDate: _unknownRefreshTo }
          }
        }
        else refresh()
      }
      if (error.outcomeUnknown === true) {
        var safeQueue = []
        for (var q = 0; q < _queue.length; q++) if (!_queue[q].mutation) safeQueue.push(_queue[q])
        _queue = safeQueue
      }
      if (completed.intent === "correctDuration") clearTimerDurationDraft()
    } else {
      phase = "ready"
      if (completed.intent === "refreshTimers") {
        adoptTimerData(data)
        if (outcomeUnknown && _unknownRefreshIntent === "refreshTimers" && !conflictPending) {
          outcomeUnknown = false
          _unknownRefreshIntent = ""
          _unknownRequest = null
          _unknownOriginalFrom = ""
          _unknownOriginalTo = ""
        }
      }
      else if (completed.intent === "refreshProjects") {
        projects = Array.isArray(data) ? data : []
        _projectsConfirmed = true
        cacheData.projects = projects
      }
      else if (completed.intent === "refreshRecentEntries") {
        recentEntries = Array.isArray(data) ? data : []
        _recentConfirmed = true
        var recentCache = []
        for (var r = 0; r < recentEntries.length; r++) recentCache.push({
          id: recentEntries[r].id,
          projectId: recentEntries[r].projectId,
          startedAt: recentEntries[r].startedAt
        })
        cacheData.recentEntries = recentCache
      }
      else if (completed.intent === "refreshDiagnostics") {
        diagnostics = data || ({})
        if (!conflictPending && !outcomeUnknown) clearError()
        if (diagnosticsReady && diagnostics.authenticated === true && diagnostics.businessSelected !== true)
          refreshBusinesses()
        else if (setupReady() && _fullRefreshRequested) {
          _fullRefreshRequested = false
          refreshOperationalData()
        }
      }
      else if (completed.intent === "configureAuth") {
        clearError()
        refreshDiagnostics()
        requestAuthorizationUrl()
      }
      else if (completed.intent === "requestAuthorizationUrl") {
        clearError()
        authorizationUrl = String((data || {}).url || "")
      }
      else if (completed.intent === "completeAuthentication") {
        clearError()
        authorizationUrl = ""
        refreshDiagnostics()
      }
      else if (completed.intent === "refreshBusinesses") {
        clearError()
        businesses = Array.isArray(data) ? data : []
      }
      else if (completed.intent === "selectBusiness") {
        clearError()
        businesses = []
        refreshDiagnostics()
      }
      else if (completed.intent === "prepareCreateEntry") {
        var createPayload = {}
        for (var createKey in completed.payload) createPayload[createKey] = completed.payload[createKey]
        createPayload.knownEntryDate = String(createPayload.localDate || "")
        createPayload.knownEntryIds = []
        var baselineEntries = Array.isArray(data) ? data : []
        for (var baselineIndex = 0; baselineIndex < baselineEntries.length; baselineIndex++)
          createPayload.knownEntryIds.push(String(baselineEntries[baselineIndex].id))
        followupCreate = {
          argv: appendFieldArguments(["time", "add"], createPayload),
          payload: createPayload
        }
      }
      else if (completed.intent === "refreshEntries") {
        var isRecoveryRead = outcomeUnknown && _unknownRefreshIntent === "refreshEntries"
          && String(completed.payload.fromDate || "") === _unknownRefreshFrom
          && String(completed.payload.toDate || "") === _unknownRefreshTo
        if (isRecoveryRead) reconcileUnknownEntry(data)
        adoptEntryData(data)
        if (isRecoveryRead && !conflictPending) {
          var restoreFrom = _unknownOriginalFrom
          var restoreTo = _unknownOriginalTo
          var recoveryFrom = _unknownRefreshFrom
          var recoveryTo = _unknownRefreshTo
          outcomeUnknown = false
          _unknownRefreshIntent = ""
          _unknownRequest = null
          _unknownRefreshFrom = ""
          _unknownRefreshTo = ""
          if (restoreFrom !== recoveryFrom || restoreTo !== recoveryTo) {
            var restoreArgv = ["time", "list"]
            if (restoreFrom !== "") restoreArgv.push("--from", restoreFrom)
            if (restoreTo !== "") restoreArgv.push("--to", restoreTo)
            followupEntryRead = {
              argv: restoreArgv,
              payload: { fromDate: restoreFrom, toDate: restoreTo }
            }
          }
          _unknownOriginalFrom = ""
          _unknownOriginalTo = ""
        }
      }
      else {
        if (!conflictPending) clearError()
        if ((completed.intent === "updateTimerNote" || completed.intent === "correctDuration") && data && data.snapshotToken)
          stateData.timerSnapshotToken = String(data.snapshotToken)
        if (completed.intent === "updateTimerNote") clearTimerNoteDraft()
        if (completed.intent === "correctDuration") clearTimerDurationDraft()
        if (completed.intent === "createEntry" || completed.intent === "updateEntry" || completed.intent === "deleteEntry") clearEntryDraft()
        reconcile = true
      }
    }
    if (phase !== "error") phase = conflictPending ? "conflict" : (timerMode === "multiple" ? "ambiguous" : "ready")
    // Mutation responses are authoritative, but their exact normalized shape
    // belongs to the CLI contract. Reconcile the whole timer set before the
    // next view treats it as current.
    if (followupEntryRead) enqueueNext("refreshEntries", followupEntryRead.argv, followupEntryRead.payload, false)
    else if (followupCreate) enqueueNext("createEntry", followupCreate.argv, followupCreate.payload, true)
    else if (reconcile) refreshAll(lastEntryFrom, lastEntryTo)
    else pump()
  }

  Connections {
    target: root.cliAdapter
    function onSucceeded(requestId, data) { root.finishRequest(requestId, data, null) }
    function onFailed(requestId, error) { root.finishRequest(requestId, null, error) }
  }

  CliAdapter { id: productionCli }

  FileView {
    id: draftFile
    path: Quickshell.statePath("kmorey.freshbooks-time-drafts.json")
    atomicWrites: true
    printErrors: false
    onAdapterUpdated: if (root._draftFileReady) writeAdapter()
    onLoaded: {
      var rawDraft = String(text() || "")
      var parsedDraft = null
      var parsedSuccessfully = true
      try {
        parsedDraft = JSON.parse(rawDraft)
      } catch (error) {
        parsedSuccessfully = false
      }
      if (!parsedSuccessfully || !parsedDraft || typeof parsedDraft !== "object" || Array.isArray(parsedDraft) || parsedDraft.schemaVersion !== 2) {
        root.preserveAndResetDraft(rawDraft)
      } else {
        root._draftFileReady = true
      }
    }
    onLoadFailed: {
      var rawDraft = String(text() || "")
      if (rawDraft !== "") {
        root.preserveAndResetDraft(rawDraft)
      } else {
        root._draftFileReady = true
      }
    }

    JsonAdapter {
      id: stateData
      property int schemaVersion: 2
      property string timerId: ""
      property string timerNote: ""
      property string timerDuration: ""
      property string timerSnapshotToken: ""
      property bool timerNoteDirty: false
      property bool timerDurationDirty: false
      property var entryDraft: ({})
    }
  }

  function preserveAndResetDraft(rawDraft) {
    if (_draftResetPending) return
    _draftResetPending = true
    _draftFileReady = false
    draftBackup.setText(String(rawDraft || ""))
  }

  function finishDraftReset() {
    if (!_draftResetPending) return
    _draftResetPending = false
    if (stateData.schemaVersion !== 2) {
      stateData.schemaVersion = 2
    }
    clearTimerDraft()
    clearEntryDraft()
    _draftFileReady = true
    draftFile.writeAdapter()
  }

  function failDraftBackup(error) {
    if (!_draftResetPending) return
    _draftResetPending = false
    _draftFileReady = false
    phase = "error"
    lastErrorCode = "DRAFT_BACKUP_FAILED"
    lastError = "Could not preserve the incompatible draft; the original file was left untouched."
  }

  FileView {
    id: draftBackup
    path: Quickshell.statePath("kmorey.freshbooks-time-drafts.incompatible.json")
    atomicWrites: true
    printErrors: false
    onSaved: root.finishDraftReset()
    onSaveFailed: function(error) { root.failDraftBackup(error) }
  }

  FileView {
    path: Quickshell.cachePath("kmorey.freshbooks-time-cache.json")
    atomicWrites: true
    printErrors: false
    onAdapterUpdated: writeAdapter()
    onLoaded: {
      if (cacheData.schemaVersion !== 1) {
        cacheData.schemaVersion = 1
        cacheData.projects = []
        cacheData.recentEntries = []
      } else {
        if (!root._projectsConfirmed && Array.isArray(cacheData.projects)) root.projects = cacheData.projects
        if (!root._recentConfirmed && Array.isArray(cacheData.recentEntries)) root.recentEntries = cacheData.recentEntries
      }
    }

    JsonAdapter {
      id: cacheData
      property int schemaVersion: 1
      property var projects: []
      property var recentEntries: []
    }
  }

  Timer {
    interval: 15000
    repeat: true
    running: root.hasVisibleConsumers
    onTriggered: {
      root.refresh()
      if (root.lastEntryFrom !== "" || root.lastEntryTo !== "") root.refreshEntries(root.lastEntryFrom, root.lastEntryTo)
    }
  }

  Component.onCompleted: {
    refreshDiagnostics()
  }
}
