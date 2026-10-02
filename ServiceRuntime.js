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
  var view = Ledger.apply(ledgerState, {}).view
  var actions = []
  var startedRequests = {}
  var refreshSequence = 0
  var pendingPartials = {}
  var activePersistId = null
  var pendingPersists = []

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
    view = result.view
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
    for (var i = 0; i < coordinatorActions.length; i++) {
      var action = coordinatorActions[i]
      if (action.type !== "complete") continue
      delete startedRequests[action.requestId]
      if (action.outcome === "known-error" && action.error
          && action.error.code === "TIMER_SWITCH_PARTIAL"
          && action.error.details && action.error.details.partialReceipt) {
        pendingPartials[action.operationId] = action.error.details.partialReceipt
        applyLedger({
          type: "completion",
          operationId: action.operationId,
          requestId: action.requestId,
          causalTag: action.causalTag,
          outcome: "unknown",
          error: action.error
        })
      } else {
        applyLedger(completionEvent(action))
      }
    }
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
    applyCoordinator({ type: "enqueue", effect: effect })
    return true
  }

  return {
    getView: function() { return view },

    submitIntent: function(intent) {
      if (!intent || typeof intent.type !== "string") return false
      if (intent.type === "refresh") return submitRefresh(intent)
      var previousRevision = view.revision
      var result = applyLedger({ type: "intent", intent: intent })
      return result.view.revision !== previousRevision
    },

    startup: function(snapshot) {
      var restored = snapshot ? Ledger.restore(snapshot) : null
      ledgerState = restored || Ledger.initialState()
      coordinatorState = Coordinator.initialState(options.budgets)
      actions = []
      startedRequests = {}
      pendingPartials = {}
      activePersistId = null
      pendingPersists = []
      var result = Ledger.apply(ledgerState, { type: "startup" })
      ledgerState = result.state
      view = result.view
      drainEffects(result.effects || [])
    },

    storeSaved: function(transactionId) {
      var result = applyLedger({ type: "persisted", transactionId: transactionId })
      var operationId = String(transactionId || "").indexOf("unknown-") === 0
        ? String(transactionId).slice("unknown-".length) : null
      if (operationId && pendingPartials[operationId]) {
        var receipt = pendingPartials[operationId]
        delete pendingPartials[operationId]
        applyLedger({
          type: "observation",
          operationId: operationId,
          causalTag: ledgerState.operations.filter(function(operation) {
            return operation.operationId === operationId
          })[0].causalTag,
          records: receipt.results,
          complete: true,
          includesDeleted: true,
          phase: receipt.phase
        })
      }
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
      handleCoordinatorActions(result.actions || [])
      queueCoordinatorActions(result.actions || [])
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
