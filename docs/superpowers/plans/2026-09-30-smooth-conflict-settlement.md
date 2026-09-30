# Smooth Conflict Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one coordinated `freshbooks-cli`/Quickshell cutover in which canonical semantic records and mutation receipts let a durable plugin ledger settle plugin-owned work, merge independent remote work, and show only genuine field-level conflicts.

**Architecture:** `freshbooks-cli` owns canonicalization, semantic guards, receipts, command-scoped record reuse, and budget diagnostics. The plugin validates that versioned contract, feeds intents/observations/completions through a durable pure-JavaScript operation ledger, and sends its effects through a capacity-one request coordinator. A shipped QML-compatible `ServiceRuntime.js` composes those two production modules; Node integration tests import that exact runtime, while `Service.qml` is only the QML adapter for persistence, CLI I/O, and published view updates. `Panel.qml` renders one immutable view. All old snapshot-conflict, global blocking, bare-response, and mandatory-refresh paths are removed in the same release cutover.

**Tech Stack:** Dependency-free Node.js 22 ESM (`freshbooks-cli`), Node.js 22 CommonJS tests and QML-compatible JavaScript (`quickshell-freshbooks`), QtQuick/Quickshell QML, `node:test`, Quickshell `FileView`/`JsonAdapter`, Omarchy plugin validator.

**Spec:** `docs/superpowers/specs/2026-09-30-smooth-conflict-settlement-design.md`

## Global Constraints

- This is one coordinated cutover: release `freshbooks-cli` 0.3.0 first, then require CLI SemVer `>=0.3.0` and canonical contract version `2` in the plugin; do not ship either repository's cutover alone.
- Keep the CLI runtime dependency-free and preserve JSON envelope schema version `1`; `canonicalContractVersion: 2` versions records, errors, receipts, and diagnostics inside that envelope.
- Normalize every identity to a non-empty decimal/string scalar, every optional identity to `string | null`, optional text to `""`, booleans to booleans, durations to non-negative integer seconds, instants to ISO-8601 UTC strings, and dates to `YYYY-MM-DD`.
- Use NFC string normalization without trimming user notes; sort Timer Segments by `startedAt`, then `id`; token input is canonical semantic data with object keys sorted and excludes `token`, `elapsedAnchor.observedAt`, display strings, raw payloads, and request metadata.
- No compatibility aliases, dual parsing, snapshot-token UI, bare mutation results, unguarded Apply Mine, mandatory post-success reads, or fallback probing of an old CLI contract.
- FreshBooks remains the sole remote authority; QML never calls HTTP, owns operation state, retains submitted drafts, decides merge policy, or mutates service records.
- The CLI adapter remains capacity one. Reads may be canceled; mutations must never be canceled for priority or automatically retried after an unknown outcome.
- Persist canonical operation/draft data only—never OAuth tokens, headers, or raw FreshBooks payloads—and atomically write before dispatch.
- Preserve unrelated working-tree changes. Each commit command below stages only the task's named files.

## Review Focus

1. Numeric/string identity aliases, missing fields, and explicit `null` must normalize deterministically or fail as typed contract errors, never create two logical records — owned by Task 1 tests `canonicalizes identity and optional aliases` and `rejects unsafe identities`.
2. Timer Segments with equal start instants or reversed endpoint order must sort by stable identity and hash identically — owned by Task 2 test `aggregates equal-start segments in stable identity order`.
3. A ledger atomic-write failure after optimistic acceptance but before dispatch must retain the draft, publish a persistent recovery error, and emit no CLI request — owned by Task 9 test `persistence failure never dispatches prepared mutation`.
4. A syntactically valid receipt whose affected identities do not cover the requested scope must be treated as an unknown mutation result, not settlement — owned by Task 8 test `rejects receipt that omits the operation scope`.
5. A broad read may supersede a narrow reconciliation read only when its coverage includes authoritative absence/deletion evidence for the narrow query — owned by Task 11 test `does not subsume deletion-sensitive reconciliation with an incomplete broad read`.

---

## Target File Structure

### `freshbooks-cli`

- Create `src/tracking.js` — canonical record constructors, stable semantic serialization/tokening, deleted markers, guard errors, receipts, and command-scoped `TrackingContext`.
- Create `test/tracking.test.js` — canonical equivalence, normalization, tokens, field-group sensitivity, deleted markers, and tracking-context unit contract.
- Create `test/request-counts.test.js` — workflow request ceilings, record reuse, ordering, and safe independent GET concurrency.
- Modify `src/freshbooks.js` — route all Time Entry/Timer reads and mutations through one command-scoped tracking context and return receipts.
- Modify `src/cli.js` — create one context per command, pass `--guard`, emit canonical observations/receipts, and advertise budgets/contract version.
- Modify `src/api.js` — expose retry-budget constants used by diagnostics; retain bounded auth/rate-limit behavior.
- Modify `src/args.js` — replace the `snapshot` option with `guard`.
- Modify `test/freshbooks.test.js`, `test/output.test.js`, `test/args.test.js`, and `test/api.test.js` — migrate all command/workflow assertions to contract v2.
- Modify `package.json`, `package-lock.json`, and `README.md` — release/versioned contract and command-budget documentation.

### `quickshell-freshbooks`

- Create `CanonicalContract.js` — strict contract-v2 validation and command/result adaptation; no legacy fallback.
- Create `OperationLedger.js` — pure event reducer implementing durable operations, semantic merge/reconciliation, record locks, effects, and immutable views.
- Create `RequestCoordinator.js` — pure capacity-one priority/coalescing/cancellation/deadline scheduler with tagged completions.
- Create `LedgerStoreModel.js` — ledger snapshot validation/serialization and corrupt/unsupported recovery classification.
- Create `LedgerStore.qml` — atomic state-directory persistence and preservation of unread incompatible/corrupt bytes.
- Create `test/canonical-contract.test.js`, `test/operation-ledger.test.js`, `test/request-coordinator.test.js`, and `test/ledger-store-model.test.js` — focused module contracts.
- Create `ServiceRuntime.js` — shipped QML-compatible factory that composes the production ledger and coordinator behind one event/action runtime.
- Create `test/service-integration.test.js` — import the exact production `ServiceRuntime.js` and exercise intent/persistence/adapter behavior with deterministic fakes; never parse QML or duplicate runtime state.
- Create `test/SmokeHarness.qml` and `test/smoke-script.json` — real Omarchy/Quickshell deterministic-adapter runtime scenario.
- Modify `Service.qml` — become a thin QML integration around `ServiceRuntime.js`, `LedgerStore`, and the selected adapter; expose `view` and intent methods only.
- Modify `CliAdapter.qml` — classify process outcomes, enforce contract v2, support read-only cancellation, and use per-request deadlines.
- Modify `FakeCliAdapter.qml` and `FakeCliModel.js` — tagged starts/cancellations/completions and scripted receipts/observations/errors.
- Modify `Panel.qml` — close editors on accepted intents and render immutable records, per-scope status, field choices, deletion recovery, and presentation-only ticks.
- Modify `BarWidget.qml` and `TimeTrackingModel.js` — consume ledger view records and canonical elapsed anchors; remove snapshot helpers.
- Modify `test/run.js`, `test/fake-cli-model.test.js`, `test/scaffold-contract.test.js`, and `test/time-tracking-model.test.js` — register new suites, retain only consumer-visible packaging/manifest checks in the scaffold contract, and replace obsolete snapshot assertions with behavior contracts.
- Delete `test/service-lifecycle.test.js` and `test/service-harness.js` after their relevant behaviors move to production-runtime integration tests.
- Modify `README.md` and `manifest.json` — contract semantics, minimum CLI 0.3.0, durable recovery behavior, and plugin release version 0.2.0.

## Shared Contract (all tasks use these exact names)

`src/tracking.js` and `CanonicalContract.js` agree on these JSON shapes:

- `CanonicalTimeEntry`: `{ contractVersion: 2, kind: "time-entry", id: string, exists: true, localDate: string, startedAt: string, durationSeconds: number, projectId: string|null, clientId: string|null, serviceId: string|null, note: string, billable: boolean, billed: boolean, token: string }`.
- `CanonicalTimerSegment`: `{ contractVersion: 2, kind: "timer-segment", id: string, timerId: string, exists: true, startedAt: string, durationSeconds: number|null, running: boolean, logged: boolean, token: string }`.
- `CanonicalActiveTimer`: `{ contractVersion: 2, kind: "active-timer", id: string, exists: true, segments: CanonicalTimerSegment[], state: "running"|"paused", elapsedAnchor: { closedSeconds: number, runningStartedAt: string|null, observedAt: string }, projectId: string|null, clientId: string|null, serviceId: string|null, note: string, billable: boolean, token: string }`.
- `CanonicalDeleted`: `{ contractVersion: 2, kind: "time-entry"|"active-timer", id: string, exists: false, token: null }`.
- `CanonicalObservation`: `{ contractVersion: 2, queryKey: string, coverage: { complete: boolean, includesDeleted: boolean, fromDate: string|null, toDate: string|null }, records: CanonicalRecord[] }`; the coordinator adds `requestId`, `scope`, and `causalTag` before the ledger sees it.
- `MutationReceipt`: `{ contractVersion: 2, mutationKind: "time-entry-create"|"time-entry-update"|"time-entry-delete"|"timer-start"|"timer-pause"|"timer-resume"|"timer-correct"|"timer-update"|"timer-log"|"timer-discard"|"timer-switch", changes: ReceiptChange[], results: CanonicalRecord[], phase: null|{ log: "confirmed", start: "confirmed"|"failed" } }`, where `ReceiptChange` is `{ scope: string, before: { token: string }|{ absent: true }, after: { record: CanonicalRecord }|{ deleted: true } }` and scope is exactly `time-entry:<id>`, `active-timer:<id>`, or `provisional:<operationId>:<time-entry-create|active-timer-create|timer-switch-target>`.
- `GUARD_REJECTED.details`: `{ contractVersion: 2, identity: { kind: "time-entry"|"active-timer", id: string }, expectedToken: string, currentToken: string|null, current: CanonicalRecord|CanonicalDeleted }`.
- `TIMER_SWITCH_PARTIAL.details`: `{ partialReceipt: MutationReceipt, startError: { code: string, message: string } }`; its receipt has `phase: { log: "confirmed", start: "failed" }`, the confirmed logged Time Entry and old Active Timer deletion, and no new Active Timer.
- Editable field groups are exactly `note`, `duration`, `date`, `assignment`, and `timer-state`; `assignment` always moves `projectId` and `serviceId` together, while `clientId` and `billable` are derived.
- Ledger API: `Ledger.initialState()`, `Ledger.restore(snapshot)`, and `Ledger.apply(state, event) -> { state, effects, view }`. Events are `intent`, `persisted`, `request-started`, `completion`, `observation`, `persistence-failed`, and `startup`; effects are `persist`, `request`, and `compact`.
- `intent` payload names are `save-entry`, `start`, `pause`, `resume`, `correct-duration`, `update-note`, `log`, `discard`, `switch`, `choose-mine`, `choose-freshbooks`, `restore-as-new`, `discard-local`, and `refresh`. Save/update intents carry `{ scope, baseToken, baseContractVersion: 2, patch, draft }`.
- Request effect: `{ effectId, operationId|null, requestId, scope, requestKind: "mutation"|"reconciliation"|"visible-read"|"quiet-read", priority: 1|2|3|4, queryKey:string|null, coverage: object|null, causalTag, commandClass: "read"|"single-write"|"multi-segment"|"log"|"switch", argv, stdin?: string }`.
- Coordinator API: `Coordinator.initialState(budgets)`, `Coordinator.apply(state, event) -> { state, actions }`; events are `enqueue`, `adapter-started`, `adapter-succeeded`, `adapter-failed`, `adapter-exited`, and `deadline`; actions are `start`, `cancel-read`, `complete`, and `drop`.
- Immutable `view`: `{ revision, records, operations, conflicts, errors, actions }`; each operation view has `{ operationId, scope, state, draftAvailable }`, each conflict has `{ operationId, scope, groups: [{ group, mine, freshbooks }], deletion: boolean }`, and `actions[scope]` has booleans `canMutate`, `canOpenDraft`, `canResolve`, and `canNavigate`.

`ServiceRuntime.js` uses the same global-function-plus-conditional-`module.exports` pattern as the other QML-compatible JavaScript modules. It exports exactly `createServiceRuntime(options)`, where `options` is `{ Ledger, Coordinator, budgets }` using the production module objects. The returned runtime owns both module states and exposes `getView() -> ImmutableView`, `submitIntent(intent) -> boolean`, `startup(snapshot)`, `storeSaved(transactionId)`, `storeFailed(transactionId, error)`, `adapterStarted(requestId)`, `adapterCompleted(completion)`, `deadline(requestId)`, and `takeActions() -> ServiceAction[]`. Each event method synchronously applies all resulting ledger/coordinator transitions; `takeActions()` drains only QML side effects shaped as `{ type:"persist", snapshot, transactionId }`, `{ type:"start", request }`, or `{ type:"cancel-read", requestId }`. `submitIntent` returns `true` exactly when the ledger accepts the intent. `Service.qml` calls these methods, performs each drained action through `LedgerStore`/the adapter, and republishes `runtime.getView()`; it contains no second queue, operation state, settlement policy, or reconciliation model.

**Reviewer gate for every task:** Review the task's diff immediately after its focused GREEN run and before starting the next task; reject changes outside its Files block, interfaces that differ from this Shared Contract, production code not driven by the named RED test, or staged paths not listed in its commit command.

### Task 1: Canonical Time Entry Records and Semantic Tokens

**Files:**
- Create: `../freshbooks-cli/src/tracking.js`
- Create: `../freshbooks-cli/test/tracking.test.js`

**Interfaces:**
- Consumes: raw list/detail/mutation Time Entry payloads and timezone.
- Produces: `CONTRACT_VERSION = 2`; `canonicalTimeEntry(raw, { timezone })`; `canonicalDeleted(kind, id)`; `semanticToken(record)`; `semanticEqual(left, right)`; `recordScope(record)` using the Shared Contract.

- [ ] **Step 1: Write failing canonical Time Entry tests.** Add exact tests `canonicalizes identity and optional aliases`, `rejects unsafe identities`, `list detail and mutation shapes have identical semantics`, `normalizes NFC without trimming notes`, and `each Time Entry field group changes the token`. Assert numeric `9` and string `"9"` both yield id `"9"`; missing/`null` ids throw `INVALID_CANONICAL_ID`; missing/`null` note yields `""`; missing ids yield `null`; `"Cafe\u0301 "` yields `"Café "`; equivalent records have equal 64-lowercase-hex tokens; changing note, duration, date, assignment, billed state, or existence changes semantic equality/token.

- [ ] **Step 2: Run the new tests and verify RED.** Run `cd ../freshbooks-cli && node --test test/tracking.test.js`; expect `ERR_MODULE_NOT_FOUND` for `src/tracking.js`.

- [ ] **Step 3: Implement the exported constants/functions.** Use recursively key-sorted JSON and SHA-256; reject unsafe/non-finite numeric identities rather than rounding; exclude only the fields listed in Global Constraints.

- [ ] **Step 4: Run the focused tests and verify GREEN.** Run `cd ../freshbooks-cli && node --test test/tracking.test.js`; expect all named tests to pass with `fail 0`.

- [ ] **Step 5: Commit only Task 1 files.**
```bash
git -C ../freshbooks-cli add src/tracking.js test/tracking.test.js
git -C ../freshbooks-cli commit -m "feat: define canonical tracking records"
```

### Task 2: Canonical Timer Aggregation and Stable Elapsed Anchors

**Files:**
- Modify: `../freshbooks-cli/src/tracking.js`
- Modify: `../freshbooks-cli/test/tracking.test.js`

**Interfaces:**
- Consumes: Task 1 normalization/token functions and raw timer-segment arrays.
- Produces: `canonicalTimerSegment(raw)` and `canonicalActiveTimers(rawSegments, { observedAt }) -> CanonicalActiveTimer[]`.

- [ ] **Step 1: Add failing timer canonicalization tests.** Add exact tests `list and timer aggregation representations have identical semantics`, `aggregates equal-start segments in stable identity order`, `wall clock observation changes no timer token`, and `timer field groups change semantics`. With segments ids `"10"` and `"2"` at `2026-09-01T14:00:00.000Z` in both orders, assert ids sort `['10','2']` lexically and tokens match; changing only `observedAt` from `15:00Z` to `15:01Z` must not change the token; running has `durationSeconds:null`, `closedSeconds:57`, and stable `runningStartedAt`.

- [ ] **Step 2: Verify RED.** Run `cd ../freshbooks-cli && node --test test/tracking.test.js --test-name-pattern='timer|segments|wall clock'`; expect missing `canonicalActiveTimers`/`canonicalTimerSegment` exports.

- [ ] **Step 3: Implement timer constructors and aggregation.** Include logged continuation segments in elapsed semantics, expose one logical Active Timer, and never hash `elapsedAnchor.observedAt`.

- [ ] **Step 4: Verify GREEN.** Run the Step 2 command; expect matching tests to pass and `fail 0`.

- [ ] **Step 5: Commit.**
```bash
git -C ../freshbooks-cli add src/tracking.js test/tracking.test.js
git -C ../freshbooks-cli commit -m "feat: canonicalize logical active timers"
```

### Task 3: Command-Scoped Tracking Context and Canonical Read Outputs

**Files:**
- Modify: `../freshbooks-cli/src/tracking.js`
- Modify: `../freshbooks-cli/src/freshbooks.js`
- Modify: `../freshbooks-cli/src/cli.js`
- Modify: `../freshbooks-cli/test/tracking.test.js`
- Modify: `../freshbooks-cli/test/freshbooks.test.js`

**Interfaces:**
- Consumes: Task 1/2 constructors.
- Produces: `new TrackingContext({ timezone, observedAt })`, `context.remember(record)`, `context.get(scope)`, `context.observe({ queryKey, coverage, records })`; `FreshBooksService.withTracking(context)`; canonical `time list` and `timer status` observations.

- [ ] **Step 1: Add failing context/read tests.** Test `tracking context reuses a remembered canonical record by scope` and update list/status tests to assert contract `2`, string ids, coverage (`timer-status` complete+includesDeleted false; date range values exact), and canonical records instead of `snapshotToken`/display fields.

- [ ] **Step 2: Verify RED.** Run `cd ../freshbooks-cli && node --test test/tracking.test.js test/freshbooks.test.js`; expect `withTracking is not a function` and old list/status shapes.

- [ ] **Step 3: Implement one context per `run()` command.** Create it after config/timezone resolution, pass it to workflows, remember raw-fetch-derived canonical records, and wrap read command JSON data as `CanonicalObservation`; keep human output derived outside canonical data.

- [ ] **Step 4: Verify GREEN.** Run the Step 2 command; expect all tests pass, `fail 0`.

- [ ] **Step 5: Commit.**
```bash
git -C ../freshbooks-cli add src/tracking.js src/freshbooks.js src/cli.js test/tracking.test.js test/freshbooks.test.js
git -C ../freshbooks-cli commit -m "feat: route reads through tracking context"
```

### Task 4: Typed Semantic Guard Rejection

**Files:**
- Modify: `../freshbooks-cli/src/tracking.js`
- Modify: `../freshbooks-cli/src/freshbooks.js`
- Modify: `../freshbooks-cli/src/cli.js`
- Modify: `../freshbooks-cli/src/args.js`
- Modify: `../freshbooks-cli/test/tracking.test.js`
- Modify: `../freshbooks-cli/test/freshbooks.test.js`
- Modify: `../freshbooks-cli/test/args.test.js`
- Modify: `../freshbooks-cli/test/output.test.js`

**Interfaces:**
- Consumes: `--guard <semantic-token>` and current context record.
- Produces: `assertGuard(expectedToken, current)` and exact `GUARD_REJECTED.details`; all update/delete/timer mutations require a guard when base exists.

- [ ] **Step 1: Write failing guard tests.** Rename parser assertions from `snapshot` to `guard`; test `guard rejection returns complete canonical current state without writing`, `deleted current state returns a canonical deleted marker`, and output JSON preserves all guard detail fields. Assert write count `0`, expected `"stale"`, current 64-hex token, and full canonical record/deleted marker.

- [ ] **Step 2: Verify RED.** Run `cd ../freshbooks-cli && node --test test/args.test.js test/tracking.test.js test/freshbooks.test.js test/output.test.js --test-name-pattern='guard|deleted current'`; expect old `REMOTE_CHANGED`/`--snapshot` behavior.

- [ ] **Step 3: Replace snapshot guards cleanly.** Remove `entrySnapshot`, `logicalTimerSnapshot`, `assertSnapshot`, every `snapshotToken` field/option, and use the immediately read/reused canonical record before the first write.

- [ ] **Step 4: Verify GREEN.** Run the Step 2 command; expect all matching tests pass with zero writes on rejection.

- [ ] **Step 5: Commit.**
```bash
git -C ../freshbooks-cli add src/tracking.js src/freshbooks.js src/cli.js src/args.js test/tracking.test.js test/freshbooks.test.js test/args.test.js test/output.test.js
git -C ../freshbooks-cli commit -m "feat: return canonical guard rejections"
```

### Task 5: Time Entry Mutation Receipts

**Files:**
- Modify: `../freshbooks-cli/src/tracking.js`
- Modify: `../freshbooks-cli/src/freshbooks.js`
- Modify: `../freshbooks-cli/src/cli.js`
- Modify: `../freshbooks-cli/test/tracking.test.js`
- Modify: `../freshbooks-cli/test/freshbooks.test.js`
- Modify: `../freshbooks-cli/test/output.test.js`

**Interfaces:**
- Consumes: canonical current/result records and `receipt(mutationKind, changes, results, phase = null)`.
- Produces: complete receipts for `time-entry-create`, `time-entry-update`, and `time-entry-delete`; delete after uses `{ deleted:true }` plus a canonical deleted result.

- [ ] **Step 1: Add failing receipt tests.** Exact tests: `time entry create receipt marks assigned identity absent before`, `update receipt carries before and after tokens`, and `delete receipt carries deleted marker`. Assert create scope `time-entry:9`, update tokens differ for note `Before`→`After`, delete results contain `{kind:'time-entry',id:'9',exists:false,token:null}`, and no bare canonical record is returned.

- [ ] **Step 2: Verify RED.** Run `cd ../freshbooks-cli && node --test test/tracking.test.js test/freshbooks.test.js test/output.test.js --test-name-pattern='receipt'`; expect `mutationKind` to be missing.

- [ ] **Step 3: Return receipts directly from confirmed API responses.** Do not add a confirmation GET; for create use the assigned response identity, and for update preserve the context's before record.

- [ ] **Step 4: Verify GREEN.** Run Step 2; expect all receipt tests pass and `fail 0`.

- [ ] **Step 5: Commit.**
```bash
git -C ../freshbooks-cli add src/tracking.js src/freshbooks.js src/cli.js test/tracking.test.js test/freshbooks.test.js test/output.test.js
git -C ../freshbooks-cli commit -m "feat: return time entry mutation receipts"
```

### Task 6: Active Timer Receipts and Truthful Timer Switch Partial

**Files:**
- Modify: `../freshbooks-cli/src/freshbooks.js`
- Modify: `../freshbooks-cli/src/cli.js`
- Modify: `../freshbooks-cli/test/freshbooks.test.js`
- Modify: `../freshbooks-cli/test/output.test.js`

**Interfaces:**
- Consumes: canonical logical Active Timers and Task 5 receipt format.
- Produces: receipts for start/pause/resume/correct/update/log/discard/switch and typed `TIMER_SWITCH_PARTIAL.details`.

- [ ] **Step 1: Add one failing test per mutation kind.** Use exact test names `timer start returns assigned receipt`, `pause resume correction and note update return logical timer receipts`, `log and discard return deletion changes`, `switch receipt covers old entry and new timer`, and `switch partial reports confirmed log and no new timer`. Assert multi-segment results contain one `active-timer` record; successful switch has `phase {log:'confirmed',start:'confirmed'}`; partial has `{log:'confirmed',start:'failed'}`, confirmed Time Entry, old deletion, and zero new active-timer results.

- [ ] **Step 2: Verify RED.** Run `cd ../freshbooks-cli && node --test test/freshbooks.test.js test/output.test.js --test-name-pattern='receipt|switch partial'`; expect bare timer/entry results and old partial details.

- [ ] **Step 3: Build receipts only from confirmed responses plus tracked context.** Enforce log confirmation before start and never synthesize a started timer when the start response failed.

- [ ] **Step 4: Verify GREEN.** Run Step 2; expect all matching tests pass, `fail 0`.

- [ ] **Step 5: Commit.**
```bash
git -C ../freshbooks-cli add src/freshbooks.js src/cli.js test/freshbooks.test.js test/output.test.js
git -C ../freshbooks-cli commit -m "feat: return active timer receipts"
```

### Task 7: Request Reuse, Concurrency, Budgets, and CLI 0.3.0 Contract

**Files:**
- Create: `../freshbooks-cli/test/request-counts.test.js`
- Modify: `../freshbooks-cli/src/api.js`
- Modify: `../freshbooks-cli/src/freshbooks.js`
- Modify: `../freshbooks-cli/src/cli.js`
- Modify: `../freshbooks-cli/test/api.test.js`
- Modify: `../freshbooks-cli/test/output.test.js`
- Modify: `../freshbooks-cli/package.json`
- Modify: `../freshbooks-cli/package-lock.json`
- Modify: `../freshbooks-cli/README.md`

**Interfaces:**
- Consumes: `TrackingContext` and API bounds.
- Produces: `COMMAND_BUDGETS_MS = { read: 64000, singleWrite: 128000, multiSegment: 320000, log: 192000, switch: 320000 }`; diagnostics `{ canonicalContractVersion:2, commandBudgetsMs:{ read, singleWrite, multiSegment, log, switch }, capabilities:[...,"canonical-tracking-v2","mutation-receipts"] }`.

- [ ] **Step 1: Add failing request-count/concurrency tests.** Exact ceilings: guarded update/delete = one detail GET + one write/delete; pause/resume/correct one-segment = one timer discovery GET plus required writes and zero confirmation GETs; three-segment note/correction = one discovery GET plus at most three segment writes; log = one discovery GET + project GET + one log PUT with no second discovery; switch = one discovery GET, target project GET, log PUT, start POST+assignment PUT, no redundant identity/project/status GET when remembered. Add `independent identity and project prerequisites overlap` using deferred promises and assert both begin before either resolves; assert guard/discovery reads finish before dependent writes begin.

- [ ] **Step 2: Verify RED.** Run `cd ../freshbooks-cli && node --test test/request-counts.test.js test/api.test.js test/output.test.js`; expect redundant status/detail requests and missing budget diagnostics.

- [ ] **Step 3: Reuse tracked records and parallelize only independent GETs.** Remove `requireRefreshedTimer`; construct canonical results from confirmed segment responses/context; export budgets derived from 15s network timeout, one auth replay, up to three bounded rate waits, and sequential workflow write ceilings.

- [ ] **Step 4: Update release contract documentation/version.** Set package and lockfile version to `0.3.0`; document canonical shapes, `--guard`, receipts, partials, budget fields, and no confirmation-read promise; remove snapshot contract text.

- [ ] **Step 5: Verify GREEN.** Run `cd ../freshbooks-cli && npm test && npm run check`; expect Node summary `fail 0` and both commands exit `0`.

- [ ] **Step 6: Commit.**
```bash
git -C ../freshbooks-cli add src/api.js src/freshbooks.js src/cli.js test/request-counts.test.js test/api.test.js test/output.test.js package.json package-lock.json README.md
git -C ../freshbooks-cli commit -m "feat: publish canonical tracking contract v2"
```

### Task 8: Plugin Contract Validator and Classified Adapter Outcomes

**Files:**
- Create: `CanonicalContract.js`
- Create: `test/canonical-contract.test.js`
- Modify: `CliAdapter.qml`
- Modify: `test/run.js`
- Modify: `test/scaffold-contract.test.js`

**Interfaces:**
- Consumes: Shared Contract, diagnostics v2, envelope schema 1, and request metadata.
- Produces: `validateDiagnostics(data)`, `validateObservation(data)`, `validateReceipt(data, request)`, `validateGuardRejection(error)`, `classifyProcessOutcome(request, processResult)`; adapter signal `completed(var completion)` where completion retains all request tags and has `outcome: "receipt"|"observation"|"known-error"|"unknown"`.

- [ ] **Step 1: Write failing validator tests.** Exact tests: `requires CLI 0.3.0 and canonical contract 2`, `accepts complete canonical observations and receipts`, `rejects receipt that omits the operation scope`, `classifies invalid JSON schema mismatch oversized signal and timeout mutations unknown`, and `keeps auth validation permission and guard failures known`. Scope-omission must return `{outcome:'unknown', error.code:'INVALID_MUTATION_RECEIPT'}`; the same malformed read is `{outcome:'known-error', error.code:'CLI_RECORD_SCHEMA_MISMATCH'}`. In `test/scaffold-contract.test.js`, delete adapter, Service, Panel, and widget tests that read implementation files and match source expressions; do not replace them with renamed symbol or wiring assertions.

- [ ] **Step 2: Verify RED.** Run `node --test test/canonical-contract.test.js`; expect missing module.

- [ ] **Step 3: Implement strict validation and adapt `CliAdapter.qml`.** Replace intent-specific bare-record validation; `execute(request)` uses `request.requestId` and `request.deadlineMs`; `cancelRead(requestId)` rejects mutations and marks only that read canceled; late exits carry `canceled:true` for coordinator rejection.

- [ ] **Step 4: Verify GREEN.** Run `npm test && omarchy plugin validate .`; expect behavior tests `fail 0` and validator exit `0`. The validator is the QML structure check; no permanent test reads QML source.

- [ ] **Step 5: Commit.**
```bash
git add CanonicalContract.js CliAdapter.qml test/canonical-contract.test.js test/run.js test/scaffold-contract.test.js
git commit -m "feat: require canonical CLI contract v2"
```

### Task 9: Durable Ledger Preparation, Receipt Settlement, and Record Locks

**Files:**
- Create: `OperationLedger.js`
- Create: `LedgerStoreModel.js`
- Create: `LedgerStore.qml`
- Create: `test/operation-ledger.test.js`
- Create: `test/ledger-store-model.test.js`
- Modify: `test/run.js`

**Interfaces:**
- Consumes: validated intents/records/receipts and Shared Ledger API.
- Produces: durable operation schema version `1`; states `prepared`, `in-flight`, `settled`, `rebasing`, `conflicted`, `unknown`, `not-applied`, `superseded`; `LedgerStore.save(snapshot, transactionId)` signals `saved(transactionId)`/`failed(transactionId,error)`.

- [ ] **Step 1: Add failing preparation/settlement tests.** Exact tests: `save prepares durable draft and optimistic immutable view before request`, `persisted then request-started transitions prepared to in-flight`, `matching receipt settles clears draft and releases only its scope`, `successful receipt emits zero mandatory follow-up reads`, `unrelated record remains mutable while one scope is locked`, and `persistence failure never dispatches prepared mutation`. Assert first reduction emits only `persist`; `persisted` emits one mutation request; failed save retains draft/projection, adds persistent `LEDGER_WRITE_FAILED`, and emits no request.

- [ ] **Step 2: Add failing store tests.** Assert serialization includes only schema/operations/records and excludes keys matching `/token|authorization|header|rawResponse/i` except canonical semantic `token`; valid schema 1 restores; corrupt/unsupported input returns `recoveryError`, unchanged `unreadText`, and no effects.

- [ ] **Step 3: Verify RED.** Run `node --test test/operation-ledger.test.js test/ledger-store-model.test.js`; expect both modules missing.

- [ ] **Step 4: Implement minimal reducer/store.** Clone/freeze every published view branch; operation ids are `operation-<monotonic sequence>` from injected generator; provisional scopes use the exact Shared Contract format; compaction is allowed only after settled/discarded drafts and locks are gone.

- [ ] **Step 5: Verify GREEN.** Run Step 3; expect all tests pass, `fail 0`.

- [ ] **Step 6: Commit.**
```bash
git add OperationLedger.js LedgerStoreModel.js LedgerStore.qml test/operation-ledger.test.js test/ledger-store-model.test.js test/run.js
git commit -m "feat: persist operation ledger before dispatch"
```

### Task 10: Semantic Three-Way Merge, Guard Rebase, and Deletion Resolution

**Files:**
- Modify: `OperationLedger.js`
- Modify: `test/operation-ledger.test.js`

**Interfaces:**
- Consumes: guard rejections/verified observations and editable group definitions.
- Produces: `changedGroups(base, candidate)`, `mergeThreeWay(base, intended, current)`, and resolution intents through `Ledger.apply`.

- [ ] **Step 1: Add the full merge matrix as failing tests.** Exact tests: `non-overlapping remote edit auto-merges and emits one newly guarded mutation`, `same-field same-value settles without a choice`, `token mismatch with equal canonical semantics settles silently`, `divergent same-field edits expose only that group`, `mine resolution guards latest current record`, `freshbooks resolution adopts only selected group`, and `second remote change re-runs merge instead of applying stale choice`. Assert assignment is one group and derived client/billability follow current until CLI revalidates; token values alone never select a merge branch.

- [ ] **Step 2: Add failing deletion/structural tests.** Exact tests: `remote deletion with unchanged local accepts deletion`, `remote deletion with local edit offers restore or discard`, `restore as new omits deleted identity and uses provisional scope`, `local delete against changed current conflicts on timer-state`, and `already achieved timer state settles while invalid structural transition conflicts`.

- [ ] **Step 3: Verify RED.** Run `node --test test/operation-ledger.test.js --test-name-pattern='merge|field|deletion|restore|timer state|remote edit|resolution'`; expect missing conflict groups/effects.

- [ ] **Step 4: Implement group-level merge and resolutions.** Merge all non-overlapping groups before publishing; Mine creates a replacement operation with lineage and latest token; FreshBooks never writes; restore uses editable semantics only and selects normal create/start mutation kind.

- [ ] **Step 5: Verify GREEN.** Run Step 3; expect all matching tests pass, `fail 0`.

- [ ] **Step 6: Commit.**
```bash
git add OperationLedger.js test/operation-ledger.test.js
git commit -m "feat: merge semantic field groups"
```

### Task 11: Unknown/Reconciliation Semantics and Request Coordinator

**Files:**
- Create: `RequestCoordinator.js`
- Create: `test/request-coordinator.test.js`
- Modify: `OperationLedger.js`
- Modify: `test/operation-ledger.test.js`
- Modify: `test/run.js`

**Interfaces:**
- Consumes: request effects, diagnostics budgets, classified completions, persisted reconciliation evidence.
- Produces: Shared Coordinator API; outer deadlines `budget + 2000ms process startup + 1000ms termination handoff`; semantic reconciliation transitions.

- [ ] **Step 1: Add failing coordinator tests.** Exact tests: `capacity never exceeds one`, `interactive mutation outranks queued reads`, `active mutation is never canceled`, `interactive mutation cancels active read and ignores its completion`, `equivalent quiet reads coalesce`, `newer complete broad read supersedes covered narrow read`, `does not subsume deletion-sensitive reconciliation with an incomplete broad read`, `overlapping scope preserves causal order`, and `outer deadline exceeds advertised class budget and reports mutation unknown`. Assert one `start` action at a time and deadline for switch is `323000` ms.

- [ ] **Step 2: Add failing reconciliation/restart tests.** Exact tests: `unknown emits reconciliation only and never mutation retry`, `update reconciliation classifies applied base and changed`, `delete reconciliation classifies absent base and changed`, `create reconciliation classifies unique absent-baseline match no match and duplicate ambiguity`, `timer transition reconciliation uses logical semantics`, `partial switch reconciles log and start separately`, `receipt followed by delayed pre-mutation observation never rolls back`, `startup restores projection draft lock and reconciliation`, and `stale cached or older causal observation cannot settle or roll back`. Assert duplicate create matches remain `unknown`; no match after complete authoritative read becomes `not-applied`; partial switch retains confirmed logged result.

- [ ] **Step 3: Verify RED.** Run `node --test test/request-coordinator.test.js test/operation-ledger.test.js --test-name-pattern='capacity|cancel|coalesce|subsume|deadline|unknown|reconciliation|startup|stale|partial'`; expect missing coordinator and reconciliation transitions.

- [ ] **Step 4: Implement scheduling and reconciliation.** Coordinator compares only priority/scope/query coverage/tags, never record fields; ledger compares semantics, rejects pre-operation causal tags, and removes duplicate queued effects only for affected scope.

- [ ] **Step 5: Verify GREEN.** Run Step 3; expect all matching tests pass, `fail 0`.

- [ ] **Step 6: Commit.**
```bash
git add RequestCoordinator.js OperationLedger.js test/request-coordinator.test.js test/operation-ledger.test.js test/run.js
git commit -m "feat: reconcile unknown operations safely"
```

### Task 12: Production Service Runtime, Thin QML Integration, Deterministic Fakes, and Complete Intent Coverage

**Files:**
- Create: `ServiceRuntime.js`
- Modify: `Service.qml`
- Modify: `FakeCliAdapter.qml`
- Modify: `FakeCliModel.js`
- Modify: `test/fake-cli-model.test.js`
- Create: `test/service-integration.test.js`
- Modify: `test/run.js`
- Delete: `test/service-lifecycle.test.js`
- Delete: `test/service-harness.js`

**Interfaces:**
- Consumes: production `Ledger` and `Coordinator` module objects, command budgets, `LedgerStore` signals, and `CliAdapter.completed`.
- Produces: the exact Shared Contract `createServiceRuntime({ Ledger, Coordinator, budgets })` factory and returned runtime methods/actions; `Service.view`; `submitIntent(intent) -> boolean`; convenience methods `saveEntry`, `start`, `pause`, `resume`, `correctDuration`, `updateNote`, `log`, `discard`, `switchTimer`, `chooseMine`, `chooseFreshBooks`, `restoreAsNew`, `discardLocal`, `refresh`. The adapter and store remain reachable only in the thin QML action executor.

- [ ] **Step 1: Write failing integration tests importing `../ServiceRuntime.js` directly.** Use the production `OperationLedger.js` and `RequestCoordinator.js`, deterministic store/adapter event drivers, and no QML parsing or duplicate state machine. Exact tests: `accepted save publishes optimistic view before adapter start`, `store save gates mutation dispatch`, `receipt settles without read`, `guard rejection rebases once`, `partial switch preserves logged result`, `unknown blocks only affected scope and queues reconciliation`, `restart loads ledger before ordinary refresh`, and `quiet refreshes coalesce`. Cover every Time Entry/Active Timer transition: create/update/delete/start/pause/resume/correct/note/log/discard/switch with receipt, conflict, and unknown table cases. Assert only the exact `getView`, event, and `takeActions` interface from Shared Contract.

- [ ] **Step 2: Extend fake tests before production integration.** Script steps accept exact `{requestKind, scope, outcome}` matches, expose `startNext`, `cancelRead`, and allow late completion; assert mismatch uses `FAKE_UNEXPECTED_REQUEST` with expected/actual tags.

- [ ] **Step 3: Verify RED.** Run `node --test test/fake-cli-model.test.js test/service-integration.test.js`; expect `ServiceRuntime.js`/`createServiceRuntime` to be missing and old fake intent matching.

- [ ] **Step 4: Implement `ServiceRuntime.js`.** Compose `Ledger.apply` and `Coordinator.apply` behind the exact factory/interface in Shared Contract. Drain reducer effects into coordinator events or the three external `ServiceAction` shapes, preserve persistence-before-dispatch, and keep view/state ownership entirely in this shipped module.

- [ ] **Step 5: Make `Service.qml` a thin runtime integration.** Import `OperationLedger.js`, `RequestCoordinator.js`, and `ServiceRuntime.js`; instantiate the factory once; translate store/adapter signals to runtime events; execute drained actions; republish only `runtime.getView()`; retain onboarding/project metadata reads and the listed convenience intent wrappers. Remove `_queue`, `_current`, snapshot/draft aliases, global `outcomeUnknown`/`conflictPending`, optimistic side channel, reconciliation callbacks, unconditional post-mutation refreshes, and old draft file. Do not recreate operation/coordinator state or settlement policy in QML.

- [ ] **Step 6: Replace old lifecycle harness/tests.** Move still-valid consumer behavior into the production-runtime integration suite, then delete the source-extraction harness and snapshot-conflict tests rather than re-pinning implementation names, forwarding, or text.

- [ ] **Step 7: Verify GREEN.** Run `node --test test/fake-cli-model.test.js test/service-integration.test.js && npm test`; expect the direct production-runtime integration and all plugin tests to pass with `fail 0`.

- [ ] **Step 8: Commit.**
```bash
git add ServiceRuntime.js Service.qml FakeCliAdapter.qml FakeCliModel.js test/fake-cli-model.test.js test/service-integration.test.js test/run.js
git rm test/service-lifecycle.test.js test/service-harness.js
git commit -m "feat: ship composed service runtime"
```

### Task 13: Immutable QML View, Field-Level Resolution, and Presentation Tick

**Files:**
- Modify: `Panel.qml`
- Modify: `BarWidget.qml`
- Modify: `TimeTrackingModel.js`
- Modify: `test/time-tracking-model.test.js`

**Interfaces:**
- Consumes: `Service.view` and Service intent methods from Task 12.
- Produces: view-only timer/calendar/project rendering; `projectElapsedSeconds(activeTimer, nowMs)` from canonical elapsed anchor; pointer/keyboard actions for conflict/deletion choices.

- [ ] **Step 1: Write the failing pure elapsed behavior test.** Replace obsolete `recordSnapshotChanged`/`optimisticTimer` tests with exact test `projects running elapsed from anchor without mutating record`: given a frozen running canonical timer with `closedSeconds:120`, `runningStartedAt:"2026-09-01T15:00:00.000Z"`, and `nowMs` 4.55 seconds later, assert `projectElapsedSeconds` returns `124`, the paused form returns `120`, and the input remains deeply equal to its pre-call value. Add no permanent test that reads Panel/BarWidget source, labels, calls, or bindings; Task 15 owns all QML interaction and presentation proof.

- [ ] **Step 2: Verify RED.** Run `node --test test/time-tracking-model.test.js --test-name-pattern='elapsed from anchor'`; expect missing `projectElapsedSeconds`.

- [ ] **Step 3: Cut Panel and BarWidget to the immutable view.** Keep transient text only while an editor is open; build patches by field group; close immediately after accepted save; show per-record settling/unknown/error state; leave unrelated controls/navigation enabled; render unconflicted merged values while conflict rows are visible. Provide pointer and keyboard activation for Mine, FreshBooks, Restore as new, and Discard local.

- [ ] **Step 4: Remove old UI paths.** Delete Reload/Apply Mine, `entrySnapshotToken`, global `canMutate`, mutable draft hydration/persistence, snapshot conflict banners, and per-second writes; the `SystemClock` may only be passed into `projectElapsedSeconds` during binding evaluation. Do not add absence assertions for the removed names.

- [ ] **Step 5: Verify model behavior and QML structure.** Run `node --test test/time-tracking-model.test.js && omarchy plugin validate .`; expect behavior tests `fail 0` and validator exit `0`. If the Task 15 harness is already available in the execution workspace, also run its real QML smoke; otherwise Task 15 is the required UI proof before release.

- [ ] **Step 6: Commit.**
```bash
git add Panel.qml BarWidget.qml TimeTrackingModel.js test/time-tracking-model.test.js
git commit -m "feat: render immutable settlement view"
```

### Task 14: Clean Cutover Documentation, Versions, and Automated Contract Gate

**Files:**
- Modify: `README.md`
- Modify: `manifest.json`
- Modify: `test/scaffold-contract.test.js`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: completed CLI 0.3.0, plugin contract v2, and the production runtime integration suite.
- Produces: plugin version `0.2.0`, documented minimum CLI `0.3.0`, consumer-visible package metadata, and CI execution of behavior/runtime validation.

- [ ] **Step 1: Add the failing packaging assertion and remove implementation assertions.** In `test/scaffold-contract.test.js`, keep only behavior visible through parsed package/manifest data (including version `0.2.0`, schema, kinds, entry points, load policy, and bar-widget placement). Delete every assertion that reads QML/JavaScript/README/workflow source to match wording, labels, method names, symbols, copies, forwarding, wiring, or the absence of obsolete implementation. Do not re-pin removed methods under new names. Runtime contract validation remains in `test/canonical-contract.test.js` and `test/service-integration.test.js`.

- [ ] **Step 2: Verify RED.** Run `node --test test/scaffold-contract.test.js`; expect the manifest version assertion to fail before `manifest.json` is updated.

- [ ] **Step 3: Update release docs and CI.** Explain optimistic close, durable draft/unknown recovery, field choices, deletion restore, no auto-retry, receipt fast path, and state-file privacy; update CI to run the existing Node behavior/runtime suite and Omarchy validator without adding dependencies. Documentation and workflow correctness are verified by their actual consumers/gates, not source-text tests.

- [ ] **Step 4: Verify both repository release gates.** Run `cd ../freshbooks-cli && npm test && npm run check && cd ../quickshell-freshbooks && npm test && omarchy plugin validate .`; expect both Node summaries `fail 0`, syntax check exit `0`, and `Plugin is valid` (or validator exit `0`).

- [ ] **Step 5: Commit.**
```bash
git add README.md manifest.json test/scaffold-contract.test.js .github/workflows/ci.yml
git commit -m "docs: publish smooth settlement contract"
```

### Task 15: Real Omarchy/Quickshell Deterministic Smoke Gate

**Files:**
- Create: `test/SmokeHarness.qml`
- Create: `test/smoke-script.json`
- Modify: `FakeCliAdapter.qml`
- Modify: `README.md`

**Interfaces:**
- Consumes: real `Service.qml`, `ServiceRuntime.js`, `Panel.qml`, `LedgerStore.qml`, and deterministic fake adapter.
- Produces: a development-only harness selected explicitly by `SMOOTH_SETTLEMENT_SMOKE=1`; production startup never selects it. The harness drives and visibly records QML checkpoints but adds no source-text contract test.

- [ ] **Step 1: Verify the real smoke is RED before the harness exists.** From an Omarchy graphical session with isolated roots, run `SMOOTH_SETTLEMENT_SMOKE=1 XDG_STATE_HOME=$(mktemp -d) XDG_CACHE_HOME=$(mktemp -d) quickshell -p test/SmokeHarness.qml`; expect startup to fail because the harness is missing. This is a runtime load check, not a permanent source assertion.

- [ ] **Step 2: Implement the deterministic real-QML harness.** Instantiate the real Service and Panel, inject `FakeCliAdapter`, consume `test/smoke-script.json`, and persist restart state only under the temporary Quickshell state root. Script optimistic entry save, delayed old observation, receipt, two independent note/duration conflicts, deletion conflict, unknown+restart, and running-anchor tick. Expose visible checkpoint/result rows (`SMOKE-1` through `SMOKE-7`) and real pointer/keyboard targets; failures must remain visible and make the harness exit nonzero when the scenario finishes.

- [ ] **Step 3: Validate QML structure.** Run `npm test && omarchy plugin validate .`; expect Node behavior/runtime tests `fail 0` and validator exit `0`. Do not add a Node harness contract, source scan, or production-file absence assertion.

- [ ] **Step 4: Run and record the real QML smoke.** Run the Step 1 command again and exercise both pointer and keyboard paths on actual QML controls. Verify: Save closes the editor immediately and displays optimism; the delayed observation causes no flash/revert; the receipt settles with no read; only the affected record shows settling, unknown, or error status while unrelated navigation/actions remain enabled; the UI displays separate note and duration conflict rows with Mine/FreshBooks choices and both pointer and keyboard selection work; deletion recovery visibly offers and activates Restore as new and Discard local; restart restores only the affected unknown lock/draft and emits no mutation retry; elapsed text advances while serialized ledger bytes and view revision stay unchanged. Record `SMOKE-1` through `SMOKE-7` results in commit/PR validation notes. Expected terminal result: all checkpoints pass and the process exits `0` with no QML errors.

- [ ] **Step 5: Commit.**
```bash
git add test/SmokeHarness.qml test/smoke-script.json FakeCliAdapter.qml README.md
git commit -m "test: add real QML settlement smoke"
```

## Coordinated Release Order

1. Land Tasks 1–7 in `freshbooks-cli`, publish 0.3.0, and verify `freshbooks diagnostics status --json` reports `canonicalContractVersion: 2` and all five budget keys.
2. Land Tasks 8–15 in `quickshell-freshbooks` without releasing an intermediate compatibility build.
3. Repeat Task 14's two-repository gates and Task 15's real QML smoke against the installed CLI 0.3.0 binary.
4. Release plugin 0.2.0; there is no supported plugin-new/CLI-old or CLI-bare-response compatibility mode.
