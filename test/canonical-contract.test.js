const test = require('node:test')
const assert = require('node:assert/strict')

const Contract = require('../CanonicalContract.js')

const token = 'a'.repeat(64)

function entry(id = '9') {
  return {
    contractVersion: 2,
    kind: 'time-entry',
    id,
    exists: true,
    localDate: '2026-09-02',
    startedAt: '2026-09-02T17:00:00.000Z',
    durationSeconds: 3600,
    projectId: '44',
    clientId: '55',
    serviceId: '66',
    note: 'Planning',
    billable: true,
    billed: false,
    token
  }
}

function segment() {
  return {
    contractVersion: 2,
    kind: 'timer-segment',
    id: '10',
    timerId: '901',
    exists: true,
    startedAt: '2026-09-02T17:00:00.000Z',
    durationSeconds: null,
    running: true,
    logged: false,
    token
  }
}

function timer(id = '901') {
  const timerSegment = { ...segment(), timerId: id }
  return {
    contractVersion: 2,
    kind: 'active-timer',
    id,
    exists: true,
    segments: [timerSegment],
    state: 'running',
    elapsedAnchor: {
      closedSeconds: 0,
      runningStartedAt: '2026-09-02T17:00:00.000Z',
      observedAt: '2026-09-02T17:01:00.000Z'
    },
    projectId: '44',
    clientId: '55',
    serviceId: '66',
    note: 'Planning',
    billable: true,
    token
  }
}

function observation(records = [entry()]) {
  return {
    contractVersion: 2,
    queryKey: 'time:2026-09-02:2026-09-02',
    coverage: {
      complete: true,
      includesDeleted: false,
      fromDate: '2026-09-02',
      toDate: '2026-09-02'
    },
    records
  }
}

function receipt(scope = 'time-entry:9') {
  const record = entry()
  return {
    contractVersion: 2,
    mutationKind: 'time-entry-update',
    changes: [{
      scope,
      before: { token },
      after: { record }
    }],
    results: [record],
    phase: null
  }
}

function deleted(kind, id) {
  return { contractVersion: 2, kind, id, exists: false, token: null }
}

function partialSwitchReceipt() {
  const logged = entry('903')
  const oldTimer = deleted('active-timer', '901')
  return {
    contractVersion: 2,
    mutationKind: 'timer-switch',
    changes: [
      {
        scope: 'time-entry:903',
        before: { absent: true },
        after: { record: logged }
      },
      {
        scope: 'active-timer:901',
        before: { token },
        after: { deleted: true }
      }
    ],
    results: [logged, oldTimer],
    phase: { log: 'confirmed', start: 'failed' }
  }
}

function envelope(data) {
  return JSON.stringify({ schemaVersion: 1, ok: true, data })
}

function mutation(overrides = {}) {
  return {
    requestId: 'request-8',
    operationId: 'operation-8',
    scope: 'time-entry:9',
    requestKind: 'mutation',
    causalTag: 'cause-8',
    argv: ['time', 'update', '9'],
    deadlineMs: 128000,
    ...overrides
  }
}

function readRequest(overrides = {}) {
  return {
    requestId: 'request-read',
    operationId: null,
    scope: 'time-range:2026-09-02',
    requestKind: 'visible-read',
    causalTag: 'cause-read',
    argv: ['time', 'list'],
    deadlineMs: 64000,
    ...overrides
  }
}

test('requires CLI 0.3.0 and canonical contract 2', () => {
  const diagnostics = {
    version: '0.3.0',
    configured: true,
    authenticated: true,
    businessSelected: true,
    timezone: 'America/Chicago',
    localDate: '2026-09-02',
    canonicalContractVersion: 2,
    commandBudgetsMs: {
      read: 64000,
      singleWrite: 128000,
      multiSegment: 320000,
      log: 192000,
      switch: 320000
    },
    capabilities: [
      'semantic-guards',
      'canonical-tracking-v2',
      'mutation-receipts'
    ]
  }

  assert.equal(Contract.validateDiagnostics(diagnostics), true)
  assert.equal(Contract.validateDiagnostics({ ...diagnostics, version: '0.2.9' }), false)
  assert.equal(Contract.validateDiagnostics({ ...diagnostics, version: '0.3.0-rc.1' }), false)
  assert.equal(Contract.validateDiagnostics({ ...diagnostics, version: '0.3.0+build.8' }), true)
  assert.equal(Contract.validateDiagnostics({ ...diagnostics, version: '0.3.1-beta.1' }), true)
  assert.equal(Contract.validateDiagnostics({ ...diagnostics, version: '0.3.1-01' }), false)
  assert.equal(Contract.validateDiagnostics({ ...diagnostics, canonicalContractVersion: 1 }), false)
  assert.equal(Contract.validateDiagnostics({ ...diagnostics, capabilities: ['semantic-guards'] }), false)
})

test('accepts complete canonical observations and receipts', () => {
  assert.equal(Contract.validateObservation(observation([entry(), timer()])), true)
  assert.equal(Contract.validateReceipt(receipt(), mutation()), true)
  assert.equal(Contract.validateObservation(observation([{ ...entry(), durationSeconds: '3600' }])), false)
  assert.equal(Contract.validateReceipt({ ...receipt(), contractVersion: 1 }, mutation()), false)
  assert.equal(Contract.validateReceipt({ ...receipt(), results: [] }, mutation()), false)
  assert.equal(Contract.validateObservation(observation([{ ...entry(), durationSeconds: 1.5 }])), false)
  assert.equal(Contract.validateObservation(observation([{ ...entry(), startedAt: '2026-09-02' }])), false)
  assert.equal(Contract.validateObservation(observation([{ ...entry(), localDate: '2026-02-30' }])), false)
  const fractionalReceipt = receipt()
  fractionalReceipt.changes[0].after.record.durationSeconds = 1.5
  fractionalReceipt.results[0].durationSeconds = 1.5
  assert.equal(Contract.validateReceipt(fractionalReceipt, mutation()), false)

  const observed = Contract.classifyProcessOutcome(readRequest(), {
    exitCode: 0,
    exitStatus: 0,
    stdout: envelope(observation())
  })
  assert.equal(observed.outcome, 'observation')
  assert.deepEqual(observed.data, observation())
  assert.equal(observed.requestId, 'request-read')
  assert.equal(observed.causalTag, 'cause-read')

  const completed = Contract.classifyProcessOutcome(mutation(), {
    exitCode: 0,
    exitStatus: 0,
    stdout: envelope(receipt())
  })
  assert.equal(completed.outcome, 'receipt')
  assert.equal(completed.requestId, 'request-8')
  assert.equal(completed.operationId, 'operation-8')
  assert.equal(completed.scope, 'time-entry:9')
  assert.deepEqual(completed.data, receipt())
})

test('validates every retained metadata and onboarding response by explicit tag', () => {
  const fixtures = {
    'project-list': [{
      id: 44, title: 'Build', clientId: 55, clientName: 'Acme',
      active: true, complete: false, internal: false,
      services: [{ id: 66, name: 'Development', billable: true }]
    }],
    'business-list': [{ id: 123, name: 'Acme', accountId: 'abc', role: 'owner', active: true }],
    'business-selection': { id: 123, name: 'Acme', accountId: 'abc', role: 'owner', active: true },
    'auth-configured': {
      configured: true, clientId: 'client', redirectUri: 'https://localhost/callback',
      profile: 'default', credentialStore: 'secret-service', warning: null
    },
    'auth-url': { url: 'https://auth.example/authorize?state=opaque' },
    'auth-login': {
      authenticated: true, expiresAt: '2026-10-01T12:00:00.000Z',
      scope: 'user:profile:read', credentialStore: 'secret-service', warning: null
    }
  }
  for (const [responseKind, data] of Object.entries(fixtures)) {
    const result = Contract.classifyProcessOutcome(readRequest({ responseKind }), {
      exitCode: 0, exitStatus: 0, stdout: envelope(data)
    })
    assert.equal(result.outcome, 'observation', responseKind)
    assert.equal(result.responseKind, responseKind)
    assert.deepEqual(result.data, data)
  }
  const invalid = Contract.classifyProcessOutcome(readRequest({ responseKind: 'project-list' }), {
    exitCode: 0, exitStatus: 0, stdout: envelope([{ id: 44, title: 12 }])
  })
  assert.equal(invalid.outcome, 'known-error')
  assert.equal(invalid.error.code, 'CLI_METADATA_SCHEMA_MISMATCH')
})

test('rejects receipt that omits the operation scope', () => {
  const result = Contract.classifyProcessOutcome(mutation(), {
    exitCode: 0,
    exitStatus: 0,
    stdout: envelope(receipt('time-entry:10'))
  })

  assert.equal(result.outcome, 'unknown')
  assert.equal(result.error.code, 'INVALID_MUTATION_RECEIPT')

  const malformedRead = Contract.classifyProcessOutcome(readRequest(), {
    exitCode: 0,
    exitStatus: 0,
    stdout: envelope(observation([{ ...entry(), note: 12 }]))
  })
  assert.equal(malformedRead.outcome, 'known-error')
  assert.equal(malformedRead.error.code, 'CLI_RECORD_SCHEMA_MISMATCH')

  for (const scope of [undefined, '', 'not-a-canonical-scope']) {
    const request = mutation()
    if (scope === undefined) delete request.scope
    else request.scope = scope
    assert.equal(Contract.validateReceipt(receipt(), request), false)
  }

  const assignedCreate = receipt()
  assignedCreate.mutationKind = 'time-entry-create'
  assignedCreate.changes[0].before = { absent: true }
  assert.equal(Contract.validateReceipt(assignedCreate, mutation({
    scope: 'provisional:operation-8:time-entry-create'
  })), true)
  assert.equal(Contract.validateReceipt(assignedCreate, mutation({
    scope: 'provisional:operation-8:timer-switch-target'
  })), false)
})

test('classifies invalid JSON schema mismatch oversized signal and timeout mutations unknown', () => {
  const cases = [
    [{ exitCode: 0, exitStatus: 0, stdout: '{' }, 'INVALID_JSON'],
    [{ exitCode: 0, exitStatus: 0, stdout: JSON.stringify({ schemaVersion: 2, ok: true, data: receipt() }) }, 'CLI_SCHEMA_MISMATCH'],
    [{ responseTooLarge: true }, 'CLI_RESPONSE_TOO_LARGE'],
    [{ exitCode: 0, exitStatus: 9 }, 'CLI_SIGNAL'],
    [{ timedOut: true }, 'CLI_TIMEOUT']
  ]

  for (const [processResult, code] of cases) {
    const result = Contract.classifyProcessOutcome(mutation(), processResult)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.error.code, code)
    assert.equal(result.requestId, 'request-8')
  }
})

test('keeps auth validation permission and guard failures known', () => {
  const declared = [
    { code: 'AUTH_REQUIRED', message: 'Login required' },
    { code: 'INVALID_DURATION', message: 'Duration is invalid' },
    { code: 'PERMISSION_DENIED', message: 'Not permitted', status: 403 }
  ]
  for (const error of declared) {
    const result = Contract.classifyProcessOutcome(mutation(), {
      exitCode: 1,
      exitStatus: 0,
      stderr: JSON.stringify({ schemaVersion: 1, ok: false, error })
    })
    assert.equal(result.outcome, 'known-error')
    assert.deepEqual(result.error, error)
  }

  const current = entry()
  const guard = {
    code: 'GUARD_REJECTED',
    message: 'Changed',
    details: {
      contractVersion: 2,
      identity: { kind: 'time-entry', id: '9' },
      expectedToken: 'b'.repeat(64),
      currentToken: current.token,
      current
    }
  }
  assert.equal(Contract.validateGuardRejection(guard), true)
  const guardResult = Contract.classifyProcessOutcome(mutation(), {
    exitCode: 1,
    exitStatus: 0,
    stderr: JSON.stringify({ schemaVersion: 1, ok: false, error: guard })
  })
  assert.equal(guardResult.outcome, 'known-error')
  assert.deepEqual(guardResult.error.details.current, current)

  const partialReceipt = partialSwitchReceipt()
  const partial = {
    code: 'TIMER_SWITCH_PARTIAL',
    message: 'Logged but did not start',
    details: {
      partialReceipt,
      startError: { code: 'START_FAILED', message: 'Rejected' }
    }
  }
  const partialRequest = mutation({
    scope: 'provisional:operation-8:timer-switch-target',
    mutationKind: 'timer-switch'
  })
  const classifyPartial = (error, request = partialRequest) => Contract.classifyProcessOutcome(request, {
    exitCode: 1,
    exitStatus: 0,
    stderr: JSON.stringify({ schemaVersion: 1, ok: false, error })
  })
  const partialResult = classifyPartial(partial)
  assert.equal(partialResult.outcome, 'known-error')
  assert.deepEqual(partialResult.error.details.partialReceipt, partialReceipt)

  assert.equal(classifyPartial(partial, mutation({
    scope: 'provisional:operation-9:timer-switch-target',
    mutationKind: 'timer-switch'
  })).outcome, 'unknown')
  const withoutOldDeletion = {
    ...partial,
    details: {
      ...partial.details,
      partialReceipt: {
        ...partialReceipt,
        changes: partialReceipt.changes.slice(0, 1),
        results: partialReceipt.results.slice(0, 1)
      }
    }
  }
  assert.equal(classifyPartial(withoutOldDeletion).outcome, 'unknown')

  const started = timer('905')
  const withInventedTimer = {
    ...partial,
    details: {
      ...partial.details,
      partialReceipt: {
        ...partialReceipt,
        changes: partialReceipt.changes.concat({
          scope: 'active-timer:905',
          before: { absent: true },
          after: { record: started }
        }),
        results: partialReceipt.results.concat(started)
      }
    }
  }
  assert.equal(classifyPartial(withInventedTimer).outcome, 'unknown')
})
