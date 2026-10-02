function immutableCopy(value) {
  if (Array.isArray(value)) {
    var items = []
    for (var i = 0; i < value.length; i++) items.push(immutableCopy(value[i]))
    return Object.freeze(items)
  }
  if (value && typeof value === "object") {
    var copy = {}
    var keys = Object.keys(value)
    for (var j = 0; j < keys.length; j++) copy[keys[j]] = immutableCopy(value[keys[j]])
    return Object.freeze(copy)
  }
  return value
}

function createServiceRuntime(options) {
  options = options || {}
  var Ledger = options.Ledger
  var Coordinator = options.Coordinator
  if (!Ledger || typeof Ledger.initialState !== "function" || typeof Ledger.apply !== "function")
    throw new Error("createServiceRuntime requires Ledger")
  if (!Coordinator || typeof Coordinator.initialState !== "function" || typeof Coordinator.apply !== "function")
    throw new Error("createServiceRuntime requires Coordinator")

  var ledgerState = Ledger.initialState()
  var coordinatorState = Coordinator.initialState(options.budgets)
  var ledgerView = Ledger.apply(ledgerState, {}).view
  var projects = Object.freeze([])
  var view
  var actions = []
  var startedRequests = {}
  var refreshSequence = 0
  var activePersistId = null
  var pendingPersists = []


  function publishView() {
    var next = {}
    var keys = Object.keys(ledgerView)
    for (var i = 0; i < keys.length; i++) next[keys[i]] = ledgerView[keys[i]]
    next.projects = projects
    view = Object.freeze(next)
  }

  publishView()
  function queuePersist(effect) {
    var action = {
      type: "persist",
      snapshot: effect.snapshot,
      transactionId: effect.transactionId
    }
    if (activePersistId === null) {
      activePersistId = effect.transactionId
      actions.push(action)
    } else {
      pendingPersists.push(action)
    }
  }

  function finishPersist(transactionId) {
    if (String(transactionId || "") !== String(activePersistId || "")) return
    activePersistId = null
    if (pendingPersists.length === 0) return
    var next = pendingPersists.shift()
    activePersistId = next.transactionId
    actions.push(next)
  }

  function queueCoordinatorActions(coordinatorActions) {
    for (var i = 0; i < coordinatorActions.length; i++) {
      var action = coordinatorActions[i]
      if (action.type === "start") {
        var request = action.request
        var executable = {}
        var keys = Object.keys(request)
        for (var j = 0; j < keys.length; j++) executable[keys[j]] = request[keys[j]]
        executable.deadlineMs = action.deadlineMs
        startedRequests[request.requestId] = request
        actions.push({ type: "start", request: executable })
      } else if (action.type === "cancel-read") {
        actions.push({ type: "cancel-read", requestId: action.request.requestId })
      }
    }
  }

  function applyCoordinator(event) {
    var result = Coordinator.apply(coordinatorState, event)
    coordinatorState = result.state
    queueCoordinatorActions(result.actions || [])
    return result.actions || []
  }

  function drainEffects(effects) {
    for (var i = 0; i < effects.length; i++) {
      var effect = effects[i]
      if (effect.type === "persist") {
        queuePersist(effect)
      } else if (effect.type === "request") {
        applyCoordinator({ type: "enqueue", effect: effect })
      }
    }
  }

  function applyLedger(event) {
    var result = Ledger.apply(ledgerState, event)
    ledgerState = result.state
    ledgerView = result.view
    publishView()
    drainEffects(result.effects || [])
    return result
  }

  function completionEvent(action) {
    if (action.outcome === "observation") {
      var data = action.data || {}
      return {
        type: "observation",
        operationId: action.operationId,
        requestId: action.requestId,
        scope: action.scope,
        causalTag: action.causalTag,
        records: data.records,
        complete: data.coverage && data.coverage.complete,
        includesDeleted: data.coverage && data.coverage.includesDeleted,
        cached: data.cached === true,
        phase: data.phase
      }
    }
    return {
      type: "completion",
      operationId: action.operationId,
      requestId: action.requestId,
      scope: action.scope,
      causalTag: action.causalTag,
      outcome: action.outcome,
      data: action.data,
      error: action.error
    }
  }

  function handleCoordinatorActions(coordinatorActions) {
    var metadata = null
    for (var i = 0; i < coordinatorActions.length; i++) {
      var action = coordinatorActions[i]
      if (action.type !== "complete") continue
      delete startedRequests[action.requestId]
      if (action.request && action.request.responseKind
          && action.request.responseKind !== "canonical-observation") {
        metadata = {
          responseKind: action.request.responseKind,
          queryKey: action.request.queryKey,
          outcome: action.outcome
        }
        if (action.data !== undefined) metadata.data = action.data
        if (action.error !== undefined) metadata.error = action.error
        if (action.outcome === "observation" && action.request.responseKind === "project-list") {
          projects = immutableCopy(Array.isArray(action.data) ? action.data : [])
          publishView()
        }
      } else {
        applyLedger(completionEvent(action))
      }
    }
    return metadata
  }

  function submitRefresh(intent) {
    refreshSequence += 1
    var requestId = intent.requestId || "refresh-" + refreshSequence
    var effect = {
      type: "request",
      effectId: intent.effectId || "effect-" + requestId,
      operationId: null,
      requestId: requestId,
      scope: intent.scope === undefined ? null : intent.scope,
      requestKind: intent.requestKind || "quiet-read",
      priority: intent.priority === undefined
        ? (intent.requestKind === "visible-read" ? 3 : 4) : intent.priority,
      queryKey: intent.queryKey === undefined ? null : intent.queryKey,
      coverage: intent.coverage === undefined ? null : intent.coverage,
      causalTag: intent.causalTag || "refresh-cause-" + refreshSequence,
      commandClass: intent.commandClass || "read",
      argv: Array.isArray(intent.argv) ? intent.argv.slice() : []
    }
    if (intent.stdin !== undefined) effect.stdin = intent.stdin
    if (intent.responseKind !== undefined) effect.responseKind = intent.responseKind
    applyCoordinator({ type: "enqueue", effect: effect })
    return true
  }

  return {
    getView: function() { return view },

    submitIntent: function(intent) {
      if (!intent || typeof intent.type !== "string") return false
      if (intent.type === "refresh") return submitRefresh(intent)
      var previousState = ledgerState
      var result = applyLedger({ type: "intent", intent: intent })
      return result.state !== previousState
    },

    startup: function(snapshot) {
      var restored = snapshot ? Ledger.restore(snapshot) : null
      ledgerState = restored || Ledger.initialState()
      coordinatorState = Coordinator.initialState(options.budgets)
      actions = []
      startedRequests = {}
      activePersistId = null
      pendingPersists = []
      projects = Object.freeze([])
      var result = Ledger.apply(ledgerState, { type: "startup" })
      ledgerState = result.state
      ledgerView = result.view
      publishView()
      drainEffects(result.effects || [])
    },

    storeSaved: function(transactionId) {
      var result = applyLedger({ type: "persisted", transactionId: transactionId })
      finishPersist(transactionId)
      return result
    },

    storeFailed: function(transactionId, error) {
      applyLedger({ type: "persistence-failed", transactionId: transactionId, error: error })
      finishPersist(transactionId)
    },

    adapterStarted: function(requestId) {
      var request = startedRequests[requestId]
      applyCoordinator({ type: "adapter-started", requestId: requestId,
        causalTag: request && request.causalTag })
      if (request && request.operationId) applyLedger({
        type: "request-started",
        operationId: request.operationId,
        requestId: requestId
      })
    },

    adapterCompleted: function(completion) {
      completion = completion || {}
      var eventType
      if (completion.canceled === true) eventType = "adapter-exited"
      else if (completion.outcome === "receipt" || completion.outcome === "observation")
        eventType = "adapter-succeeded"
      else eventType = "adapter-failed"
      var event = {
        type: eventType,
        requestId: completion.requestId,
        causalTag: completion.causalTag,
        outcome: completion.outcome,
        data: completion.data,
        error: completion.error
      }
      var result = Coordinator.apply(coordinatorState, event)
      coordinatorState = result.state
      var metadata = handleCoordinatorActions(result.actions || [])
      queueCoordinatorActions(result.actions || [])
      return metadata
    },

    deadline: function(requestId) {
      var request = startedRequests[requestId]
      var result = Coordinator.apply(coordinatorState, {
        type: "deadline", requestId: requestId, causalTag: request && request.causalTag
      })
      coordinatorState = result.state
      handleCoordinatorActions(result.actions || [])
      queueCoordinatorActions(result.actions || [])
    },

    takeActions: function() {
      var drained = actions
      actions = []
      return drained
    }
  }
}

if (typeof module !== "undefined") module.exports = { createServiceRuntime: createServiceRuntime }
