import QtQuick
import Quickshell
import "TimeTrackingModel.js" as Model
import "OperationLedger.js" as Ledger
import "RequestCoordinator.js" as Coordinator
import "ServiceRuntime.js" as ServiceRuntime

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property var barWidgetRegistry: null
  property string omarchyPath: ""
  property var cliAdapter: productionCli

  property var view: runtime.getView()
  property var diagnostics: ({})
  property var businesses: []
  property string authorizationUrl: ""
  property string selectedTimerId: ""
  property string phase: "starting"
  property string lastErrorCode: ""
  property string lastError: ""
  property double lastRefreshMs: 0
  property var visibleConsumers: ({})
  property string lastEntryFrom: ""
  property string lastEntryTo: ""

  property string draftTimerId: ""
  property string draftTimerNote: ""
  property string draftTimerDuration: ""
  property bool draftTimerNoteDirty: false
  property bool draftTimerDurationDirty: false
  property var entryDraft: ({})

  readonly property var recordList: {
    var records = view && view.records ? view.records : {}
    var values = []
    var scopes = Object.keys(records)
    for (var i = 0; i < scopes.length; i++) {
      var record = records[scopes[i]]
      if (record && record.exists !== false) values.push(record)
    }
    return values
  }
  readonly property var timers: recordList.filter(function(record) { return record.kind === "active-timer" })
  readonly property var entries: recordList.filter(function(record) { return record.kind === "time-entry" })
  readonly property var recentEntries: entries
  readonly property string timerMode: Model.timerMode(timers)
  readonly property var activeTimer: Model.selectedTimer(timers, selectedTimerId)
  readonly property var state: Model.stateProjection({ timers: timers, projects: view.projects || [], entries: entries }, selectedTimerId)
  readonly property bool mutationPending: {
    var operations = view && Array.isArray(view.operations) ? view.operations : []
    for (var i = 0; i < operations.length; i++)
      if (["prepared", "in-flight", "rebasing", "unknown"].indexOf(operations[i].state) !== -1) return true
    return false
  }
  readonly property bool busy: mutationPending || (cliAdapter && cliAdapter.busy === true)
  readonly property string pendingIntent: {
    var operations = view && Array.isArray(view.operations) ? view.operations : []
    for (var i = operations.length - 1; i >= 0; i--)
      if (["prepared", "in-flight", "rebasing", "unknown"].indexOf(operations[i].state) !== -1)
        return String(operations[i].kind || "")
    return ""
  }
  readonly property var pendingPayload: ({})
  readonly property bool refreshing: cliAdapter && cliAdapter.busy === true && !mutationPending
  readonly property bool hasVisibleConsumers: Object.keys(visibleConsumers).length > 0
  readonly property bool diagnosticsReady: diagnosticsCompatible(diagnostics)

  property var runtime: ServiceRuntime.createServiceRuntime({
    Ledger: Ledger,
    Coordinator: Coordinator,
    budgets: {
      read: 64000,
      "single-write": 128000,
      "multi-segment": 320000,
      log: 192000,
      switch: 320000
    }
  })

  function publishView() {
    view = runtime.getView()
    var errors = view && Array.isArray(view.errors) ? view.errors : []
    if (errors.length > 0) {
      var latest = errors[errors.length - 1]
      lastErrorCode = String(latest.code || "")
      lastError = String(latest.message || "")
      phase = "error"
    } else if (view && Array.isArray(view.conflicts) && view.conflicts.length > 0) {
      phase = "conflict"
    } else if (diagnosticsReady) {
      phase = timerMode === "multiple" ? "ambiguous" : "ready"
    }
  }


  function flushActions() {
    var pending = runtime.takeActions()
    while (pending.length > 0) {
      for (var i = 0; i < pending.length; i++) {
        var action = pending[i]
        if (action.type === "persist") ledgerStore.save(action.snapshot, action.transactionId)
        else if (action.type === "start") {
          if (cliAdapter && cliAdapter.execute(action.request) !== false)
            runtime.adapterStarted(action.request.requestId)
        } else if (action.type === "cancel-read" && cliAdapter) cliAdapter.cancelRead(action.requestId)
      }
      pending = runtime.takeActions()
    }
    publishView()
  }

  function submitIntent(intent) {
    var accepted = runtime.submitIntent(intent)
    publishView()
    flushActions()
    return accepted
  }

  function recordScope(record) {
    return record ? String(record.kind || "") + ":" + String(record.id || "") : ""
  }

  function withGuard(argv, record) {
    var result = argv.slice()
    if (record && String(record.token || "") !== "") result.push("--guard", String(record.token))
    return result
  }

  function submitRead(queryKey, argv, coverage, requestKind, responseKind) {
    return submitIntent({
      type: "refresh",
      requestKind: requestKind || "quiet-read",
      queryKey: queryKey,
      responseKind: responseKind || "canonical-observation",
      coverage: coverage || null,
      argv: argv,
      commandClass: "read"
    })
  }

  function refresh() {
    if (!setupReady()) return false
    lastRefreshMs = Date.now()
    return submitRead("active-timer", ["timer", "status"], {
      kind: "active-timer", identity: null, from: null, to: null,
      complete: true, includesDeleted: true
    }, "quiet-read")
  }

  function refreshEntries(fromDate, toDate) {
    lastEntryFrom = String(fromDate || lastEntryFrom || "")
    lastEntryTo = String(toDate || lastEntryTo || "")
    var argv = ["time", "list"]
    if (lastEntryFrom !== "") argv.push("--from", lastEntryFrom)
    if (lastEntryTo !== "") argv.push("--to", lastEntryTo)
    return submitRead("time-entries:" + lastEntryFrom + ":" + lastEntryTo, argv, {
      kind: "time-entry", identity: null, from: lastEntryFrom || null, to: lastEntryTo || null,
      complete: true, includesDeleted: true
    }, "visible-read")
  }

  function refreshRecentEntries() {
    return submitRead("recent-time-entries", ["time", "list", "--limit", "200"], {
      kind: "time-entry", identity: null, from: null, to: null,
      complete: false, includesDeleted: false
    }, "quiet-read")
  }

  function refreshProjects() { return submitRead("projects", ["projects", "list"], null, "quiet-read", "project-list") }
  function refreshBusinesses() { return submitRead("businesses", ["business", "list"], null, "quiet-read", "business-list") }
  function refreshDiagnostics() { return submitRead("diagnostics", ["diagnostics", "status"], null, "quiet-read", "diagnostics") }

  function refreshView(target, fromDate, toDate) {
    if (target === "entries") return refreshEntries(fromDate, toDate)
    if (target === "projects") return refreshProjects()
    return refresh()
  }

  function refreshAll(fromDate, toDate) {
    refresh()
    refreshProjects()
    refreshRecentEntries()
    if (fromDate || toDate) refreshEntries(fromDate, toDate)
  }

  function setupReady() {
    return diagnosticsReady && diagnostics.configured === true
      && diagnostics.authenticated === true && diagnostics.businessSelected === true
  }

  function diagnosticsCompatible(value) {
    var data = value || {}
    var parts = String(data.version || "").split(".")
    return Number(parts[0] || 0) === 0 && Number(parts[1] || 0) >= 3
      && Number(data.canonicalContractVersion || 0) === 2
  }

  function useAdapter(adapter) {
    if (busy) return false
    cliAdapter = adapter || productionCli
    return true
  }

  function registerVisibleConsumer(consumerId) {
    var id = String(consumerId || "")
    if (id === "") return
    var next = {}
    var keys = Object.keys(visibleConsumers)
    for (var i = 0; i < keys.length; i++) next[keys[i]] = true
    next[id] = true
    visibleConsumers = next
    refresh()
  }

  function unregisterVisibleConsumer(consumerId) {
    var id = String(consumerId || "")
    var next = {}
    var keys = Object.keys(visibleConsumers)
    for (var i = 0; i < keys.length; i++) if (keys[i] !== id) next[keys[i]] = true
    visibleConsumers = next
  }

  function selectTimer(timerId) {
    var selected = Model.selectedTimer(timers, timerId)
    selectedTimerId = selected ? String(selected.id) : ""
  }

  function clearError() { lastErrorCode = ""; lastError = ""; publishView() }
  function saveEntryDraft(draft) { entryDraft = draft || ({}) }
  function clearEntryDraft() { entryDraft = ({}) }
  function clearTimerDraft() {
    draftTimerId = ""; draftTimerNote = ""; draftTimerDuration = ""
    draftTimerNoteDirty = false; draftTimerDurationDirty = false
  }
  function clearTimerNoteDraft() { draftTimerNote = ""; draftTimerNoteDirty = false }
  function clearTimerDurationDraft() { draftTimerDuration = ""; draftTimerDurationDirty = false }

  function saveEntry(intent) { return submitIntent(intent) }

  function createEntry(fields) {
    var values = fields || {}
    var intended = {
      contractVersion: 2, kind: "time-entry", id: "provisional", exists: true,
      localDate: String(values.localDate || values.date || ""), startedAt: String(values.startedAt || ""),
      durationSeconds: Number(values.durationSeconds || 0), projectId: values.projectId || null,
      clientId: values.clientId || null, serviceId: values.serviceId || null, note: String(values.note || ""),
      billable: values.billable === true, billed: false,
      token: "0000000000000000000000000000000000000000000000000000000000000000"
    }
    var argv = ["time", "add", "--date", intended.localDate, "--duration", String(intended.durationSeconds), "--project", String(intended.projectId)]
    if (intended.serviceId !== null) argv.push("--service", String(intended.serviceId))
    if (intended.note !== "") argv.push("--note", intended.note)
    return saveEntry({ type: "save-entry", scope: null, base: null, baseToken: null,
      intended: intended, patch: values, draft: values, argv: argv, commandClass: "single-write" })
  }

  function updateEntry(entryId, fields) {
    var scope = "time-entry:" + String(entryId)
    var base = view.records[scope]
    if (!base) return false
    var values = fields || {}
    var patch = {}
    if (values.note !== undefined) patch.note = String(values.note)
    if (values.durationSeconds !== undefined) patch.duration = Number(values.durationSeconds)
    if (values.localDate !== undefined) patch.date = { localDate: String(values.localDate) }
    if (values.projectId !== undefined || values.serviceId !== undefined) patch.assignment = {
      projectId: values.projectId, serviceId: values.serviceId
    }
    var argv = withGuard(["time", "update", String(entryId)], base)
    return saveEntry({ type: "save-entry", scope: scope, base: base, baseToken: base.token,
      patch: patch, draft: values, argv: argv, commandClass: "single-write" })
  }

  function deleteEntry(entryId) {
    var scope = "time-entry:" + String(entryId)
    var base = view.records[scope]
    if (!base) return false
    return saveEntry({ type: "save-entry", scope: scope, base: base, baseToken: base.token,
      intended: { contractVersion: 2, kind: "time-entry", id: String(entryId), exists: false, token: null },
      patch: { "timer-state": { state: "deleted" } }, draft: {},
      argv: withGuard(["time", "delete", String(entryId), "--yes"], base), commandClass: "single-write" })
  }

  function start(projectId, serviceId, note) {
    var now = new Date().toISOString()
    var intended = Model.projectTimerIntent("start", null, {
      projectId: projectId,
      serviceId: serviceId,
      note: note
    }, now)
    var argv = ["timer", "start", "--project", intended.projectId]
    if (intended.serviceId !== null) argv.push("--service", intended.serviceId)
    if (intended.note !== "") argv.push("--note", intended.note)
    return submitIntent({ type: "start", scope: null, base: null, intended: intended,
      patch: { "timer-state": { state: "running" } }, draft: intended, argv: argv, commandClass: "multi-segment" })
  }

  function timerIntent(type, patch, argv, commandClass) {
    if (!activeTimer) return false
    var values = {}
    if (type === "correct-duration") values.durationSeconds = Number(patch.duration)
    if (type === "update-note") values.note = String(patch.note || "")
    var intended = Model.projectTimerIntent(type, activeTimer, values, new Date().toISOString())
    return submitIntent({ type: type, scope: recordScope(activeTimer), base: activeTimer, baseToken: activeTimer.token,
      intended: intended, patch: patch, draft: values, argv: withGuard(argv, activeTimer), commandClass: commandClass || "multi-segment" })
  }

  function pause() { return activeTimer && timerIntent("pause", { "timer-state": { state: "paused" } }, ["timer", "pause", "--id", String(activeTimer.id)]) }
  function resume() { return activeTimer && !Model.timerRunning(activeTimer) && timerIntent("resume", { "timer-state": { state: "running" } }, ["timer", "resume", "--id", String(activeTimer.id)]) }
  function correctDuration(seconds) { return activeTimer && timerIntent("correct-duration", { duration: Number(seconds) }, ["timer", "correct", "--id", String(activeTimer.id), "--duration", String(seconds)]) }
  function updateNote(note) { return activeTimer && timerIntent("update-note", { note: String(note || "") }, ["timer", "update", "--id", String(activeTimer.id), "--note", String(note || "")]) }
  function updateTimerNote(note) { return updateNote(note) }
  function log() { return activeTimer && timerIntent("log", { "timer-state": { state: "logged" } }, ["timer", "log", "--id", String(activeTimer.id)], "log") }
  function logTimer() { return log() }
  function discard() { return activeTimer && timerIntent("discard", { "timer-state": { state: "deleted" } }, ["timer", "discard", "--id", String(activeTimer.id)]) }

  function switchTimer(projectId, serviceId, note) {
    if (!activeTimer) return start(projectId, serviceId, note)
    var intended = Model.projectTimerIntent("switch", activeTimer, {
      projectId: projectId,
      serviceId: serviceId,
      note: note
    }, new Date().toISOString())
    var argv = ["timer", "switch", "--project", intended.projectId]
    if (intended.serviceId !== null) argv.push("--service", intended.serviceId)
    if (intended.note !== "") argv.push("--note", intended.note)
    return submitIntent({ type: "switch", scope: null, base: activeTimer, baseToken: activeTimer.token,
      intended: intended, patch: { assignment: { projectId: intended.projectId, serviceId: intended.serviceId }, note: intended.note },
      draft: intended, argv: withGuard(argv, activeTimer), commandClass: "switch" })
  }

  function chooseMine(operationId, group) { return submitIntent({ type: "choose-mine", operationId: operationId, group: group }) }
  function chooseFreshBooks(operationId, group) { return submitIntent({ type: "choose-freshbooks", operationId: operationId, group: group }) }
  function restoreAsNew(operationId) { return submitIntent({ type: "restore-as-new", operationId: operationId }) }
  function discardLocal(operationId) { return submitIntent({ type: "discard-local", operationId: operationId }) }
  function resolveConflictReload() {
    var conflict = view && view.conflicts && view.conflicts[0]
    return conflict ? discardLocal(conflict.operationId) : false
  }
  function resolveConflictApplyMine() {
    var conflict = view && view.conflicts && view.conflicts[0]
    if (!conflict || !conflict.groups.length) return false
    return chooseMine(conflict.operationId, conflict.groups[0].group)
  }

  function configureAuth(clientId, clientSecret, redirectUri) {
    return submitIntent({
      type: "refresh", requestKind: "visible-read", queryKey: "configure-auth",
      responseKind: "auth-configured", coverage: null,
      argv: ["auth", "configure", "--client-id", String(clientId),
        "--client-secret-stdin", "--redirect-uri", String(redirectUri)],
      stdin: String(clientSecret), commandClass: "read"
    })
  }
  function requestAuthorizationUrl() {
    authorizationUrl = ""
    return submitRead("authorization-url", ["auth", "url"], null, "visible-read", "auth-url")
  }
  function completeAuthentication(codeOrUrl) {
    return submitIntent({
      type: "refresh", requestKind: "visible-read", queryKey: "authentication",
      responseKind: "auth-login", coverage: null,
      argv: ["auth", "login", "--code-stdin"], stdin: String(codeOrUrl), commandClass: "read"
    })
  }
  function selectBusiness(businessId) {
    return submitRead("select-business", ["business", "use", String(businessId)],
      null, "visible-read", "business-selection")
  }

  function adoptMetadata(completion) {
    if (!completion) return
    var kind = String(completion.responseKind || "")
    var data = completion.data
    if (completion.outcome === "observation") {
      if (kind === "diagnostics" && data) diagnostics = data
      else if (kind === "business-list") businesses = data
      else if (kind === "auth-url") authorizationUrl = String(data && data.url || "")
      else if (kind === "auth-configured") {
        refreshDiagnostics()
        requestAuthorizationUrl()
      } else if (kind === "auth-login") {
        authorizationUrl = ""
        refreshDiagnostics()
      } else if (kind === "business-selection") {
        businesses = []
        refreshDiagnostics()
      }
    } else if (completion.outcome === "known-error" || completion.outcome === "unknown") {
      lastErrorCode = String(completion.error && completion.error.code || "CLI_ERROR")
      lastError = String(completion.error && completion.error.message || "FreshBooks request failed")
    }
  }

  Connections {
    target: root.cliAdapter
    function onCompleted(completion) {
      var metadata = root.runtime.adapterCompleted(completion)
      root.adoptMetadata(metadata)
      root.publishView()
      root.flushActions()
    }
  }

  CliAdapter { id: productionCli }
  LedgerStore {
    id: ledgerStore
    onLoaded: function(snapshot, recoveryError, unreadText) {
      root.runtime.startup(snapshot, recoveryError)
      if (recoveryError) {
        root.lastErrorCode = String(recoveryError.code || "LEDGER_RECOVERY_FAILED")
        root.lastError = String(recoveryError.message || "The operation ledger could not be restored")
      }
      root.publishView()
      root.flushActions()
      root.refreshDiagnostics()
    }
    onSaved: function(transactionId) {
      root.runtime.storeSaved(transactionId)
      root.publishView()
      root.flushActions()
    }
    onFailed: function(transactionId, error) {
      root.runtime.storeFailed(transactionId, error)
      root.publishView()
      root.flushActions()
    }
  }

  Timer {
    interval: 15000
    repeat: false
    running: root.hasVisibleConsumers && !root.busy
    onTriggered: {
      root.refresh()
      if (root.lastEntryFrom !== "" || root.lastEntryTo !== "") root.refreshEntries(root.lastEntryFrom, root.lastEntryTo)
    }
  }
}
