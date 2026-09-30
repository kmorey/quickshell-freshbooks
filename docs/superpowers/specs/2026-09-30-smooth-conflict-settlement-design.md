# Smooth FreshBooks Conflict Settlement Design

## Intent

Saving from the FreshBooks Time plugin must feel immediate without hiding concurrency or creating duplicate work. The user closes an editor as soon as Save is accepted locally and sees an optimistic result. Behind that view, the system proves what FreshBooks accepted, silently settles plugin-owned changes, merges verified independent external changes, and asks the user only about fields whose meanings genuinely diverged.

FreshBooks remains authoritative. “Authoritative” does not mean every newly fetched representation replaces newer local knowledge: observations must be interpreted with their causal context, and equivalent domain state must compare equal even when endpoints serialize it differently.

This is one coordinated cutover across `freshbooks-cli` and `quickshell-freshbooks`. The CLI gains a canonical tracking module and mutation receipts. The plugin gains an operation ledger and immutable ledger view. The existing request coordinator becomes a scheduling module rather than the owner of conflict policy. QML sends intents and renders the ledger view.

### Non-goals

- Do not add a second remote authority, a daemon, webhooks, or direct FreshBooks HTTP access from QML.
- Do not make raw response equality, timestamps, endpoint-specific shapes, or token mismatch into domain conflict rules.
- Do not make the request coordinator understand merge semantics.
- Do not make QML own drafts, operation state, retries, or settlement.
- Do not emulate FreshBooks timer state locally. Per-second ticking is a presentation projection only.
- Do not provide parallel mutation execution through the capacity-one CLI adapter.
- Do not preserve the current snapshot-conflict interface as a compatibility layer. This is a clean cutover of every caller in both repositories.
- Do not expand the product beyond existing Active Timer, Timer Segment, Timer Switch, Duration Correction, Project Shortcut, and Time Entry behavior.

## Systemic Diagnosis

The current integration conflates four different facts:

1. a FreshBooks response has a different representation;
2. a canonical domain record has changed;
3. a change was produced by this plugin;
4. a local edit and an external edit changed the same semantic field.

A snapshot token can establish the second fact only if every endpoint first produces the same canonical record. It cannot establish the third or fourth facts. Treating any token mismatch as a user conflict therefore reports false conflicts after plugin-owned mutations, after harmless endpoint-shape differences, and after non-overlapping external edits.

The current singleton service also combines request scheduling, mutable remote snapshots, draft retention, optimistic updates, timeout recovery, and conflict presentation. That shallow interface spreads semantic policy into command construction, completion callbacks, and QML. The result has poor locality: a new mutation must update queue behavior, snapshots, draft rules, optimistic state, reconciliation, and UI flags together.

The design creates three deep modules at explicit seams:

- `freshbooks-cli` owns canonical FreshBooks tracking semantics.
- The plugin operation ledger owns local causality and settlement.
- The plugin request coordinator owns the capacity-one process adapter.

Each module exposes one interface that callers and tests use. Canonicalization provides leverage across every endpoint. The ledger provides locality for every conflict and recovery rule. The coordinator hides process scheduling without becoming a second semantic authority.

## Domain Behavior

The following behavior is normative:

- A plugin-owned mutation that is confirmed by its receipt settles silently.
- A later observation equal to the receipt’s canonical result remains settled even if its raw JSON or token was produced through another endpoint.
- Canonical semantic equality defines change. **A token mismatch alone is never a user conflict.**
- Verified external changes to fields untouched by the local operation merge automatically.
- If local and external work changed the same field group to different canonical values, the view presents a choice for that field group: **Mine** or **FreshBooks**.
- If both sides changed a field group to the same canonical value, it is settled and no choice is shown.
- If FreshBooks deleted a record while the user edited it, the choices are **Restore as new** or **Discard local**. Restore creates a new record of the same domain kind through the normal Time Entry creation or Active Timer start contract; it never writes the deleted identity.
- Save closes the editor immediately and paints the optimistic projection.
- The saved draft remains recoverable until the operation settles. Closing the editor is not evidence of remote success.
- An unknown mutation outcome blocks only the affected record or provisional creation scope. Other records, reads, navigation, and unrelated mutations remain enabled.
- Unknown outcomes survive restart and reconcile against canonical semantics.
- **An unknown mutation is never auto-retried.** A later explicit user intent may create a new operation only after reconciliation classifies the previous one as not applied or the user resolves an ambiguity.

## Architecture, Modules, and Seams

```text
QML intents ──> operation ledger ──> request coordinator ──> CLI adapter
    ^                  |                      |                    |
    |                  v                      v                    v
immutable view <── canonical observations <── completions <── freshbooks-cli
                                                               |
                                                   canonical tracking module
                                                               |
                                                          FreshBooks
```

### Canonical tracking module (`freshbooks-cli`)

Its interface accepts list, detail, timer-segment, and mutation response data and returns canonical records. It also guards mutations and creates receipts. Its implementation owns endpoint-specific extraction, null/default handling, ordering, domain field selection, and semantic tokens. No plugin caller learns raw FreshBooks shapes.

The module is used by all Time Entry and Active Timer reads and writes. A command workflow creates one command-scoped tracking context so records already fetched during guard checks, timer discovery, logging, or switching can be reused.

### Operation ledger module (`quickshell-freshbooks`)

Its interface accepts user intents, canonical observations, receipts, and classified process outcomes. It returns effects for the coordinator and one immutable view for QML. Its implementation owns operation identity, durable drafts, base records, local patches, optimistic projections, semantic three-way merge, record-scoped locks, conflict choices, and restart reconciliation.

The ledger is the only module that decides whether an observation settles an operation, triggers an automatic non-overlapping rebase, or requires user choice.

### Request coordinator module (`quickshell-freshbooks`)

Its interface accepts ledger effects and emits tagged completions. Its implementation owns serialization, priority, read coalescing, supersession, safe read cancellation, stale-completion rejection, and timeout handoff. It remains the sole caller of the capacity-one CLI adapter.

The coordinator does not inspect record fields, compare tokens, merge patches, clear drafts, or decide conflicts.

### QML view seam

QML sends intents such as save, pause, resume, log, switch, choose Mine, choose FreshBooks, restore as new, discard local, and refresh. It renders a single immutable ledger view containing canonical records, optimistic projections, per-record settlement state, field conflicts, actionable errors, and enabled actions. Views do not retain an independent mutable copy after an intent is submitted.

## Canonical Semantic Record Contract

### Canonical records

The CLI exposes versioned canonical records for:

- `TimeEntry`: identity, local date/start semantics, duration seconds, project/client/service identity, note, billability, billed state, and existence;
- `TimerSegment`: segment identity, logical timer identity, start anchor, closed duration or running state, and logged state;
- `ActiveTimer`: logical timer identity, ordered canonical segments, running/paused state, elapsed anchor, project/client/service identity, note, and billability.

Identity values use one stable scalar representation. Optional values use one declared representation rather than alternating among missing, empty string, and `null`. Strings, booleans, integer seconds, instants, and local dates are normalized before comparison. Segment arrays are ordered by semantic start and stable identity, not endpoint order. Derived display strings and observation timestamps are excluded.

Running elapsed time is represented by a stable server-derived anchor plus observation time. Wall-clock advancement is not a semantic mutation and does not change the token every second. QML computes the visible tick from that anchor.

The editable field groups are:

- `note`;
- `duration`;
- `date` for a logged Time Entry;
- `assignment`, comprising project and service together. Client and billability are FreshBooks/CLI-derived consequences and are not independent local choices;
- `timer-state`, comprising running, paused, logged, or deleted state and the segment structure needed to establish it.

A group may contain multiple canonical properties when they must remain valid together. Merge and conflict presentation operate on these groups, not arbitrary JSON keys.

### Semantic token

A semantic token is a deterministic digest of the versioned canonical semantic record. It excludes raw endpoint fields, response ordering, formatting aliases, display-only elapsed text, request metadata, and observation time. Equivalent records from list, detail, timer-segment aggregation, and mutation responses produce the same token.

Tokens are opaque guards and efficient equality hints. Callers must compare canonical records when classifying a mismatch. A changed token with canonical equality is settled without user-visible conflict. Token algorithm or canonical-schema changes require a contract version change; persisted operations retain their canonical base and schema version, so restart migration does not rely on comparing tokens from different versions.

### Guard rejection

A guarded mutation carries the base semantic token. The CLI reads or reuses the current canonical record immediately before the first write. If the guard does not match, the CLI performs no write and returns a typed guard rejection containing:

- affected identity;
- expected token;
- current token;
- complete current canonical record, or a canonical deleted marker;
- canonical contract version.

A guard rejection is a known non-mutation, not an unknown outcome. The ledger can therefore merge it and, when no field group overlaps, issue one newly guarded mutation rebased onto the returned current record. This safe rebase is distinct from retrying an unknown mutation.

### Mutation receipt

Every successful mutation returns a receipt rather than a bare record. The receipt contains:

- mutation kind;
- every affected logical identity, including old and new identities for Timer Switch and the assigned identity for creation;
- before token or an explicit absent marker;
- after token or an explicit deleted marker;
- complete canonical result records needed to render and settle immediately;
- canonical contract version.

A Timer Switch receipt truthfully records both phases: the logged Time Entry and the new Active Timer. If logging succeeds and start fails, the typed partial result includes the confirmed logged result and no claimed new timer. Multi-segment timer mutations include one logical Active Timer result; QML never assembles it from segment responses.

The CLI must not claim success until the returned canonical result follows from confirmed FreshBooks responses. A receipt is sufficient for immediate settlement; it does not require a mandatory post-mutation read.

## Operation Ledger State and Transitions

### Durable operation

Before dispatch, the ledger atomically persists:

- plugin-owned operation ID;
- operation kind and affected record scope;
- canonical contract version;
- canonical base record or absent base;
- local field-group patch and intended canonical result;
- optimistic projection;
- original durable draft;
- dispatch state and reconciliation evidence, including known identities for creation;
- causal request tag and timestamps used for diagnostics, not equality.

The operation ID belongs to the plugin. It identifies local causality and persistence; it is not treated as a FreshBooks idempotency key.

### States

An operation moves through these states:

1. `prepared`: durable, not yet handed to the coordinator;
2. `in-flight`: mutation process started; its record scope is locked;
3. `settled`: a receipt or semantic reconciliation proves the intended result;
4. `rebasing`: a definite guard rejection or verified observation is being three-way merged;
5. `conflicted`: one or more field groups need Mine/FreshBooks choices, or deletion needs restore/discard;
6. `unknown`: process loss, timeout, signal, invalid/oversized mutation response, or shutdown prevents knowing whether FreshBooks applied it;
7. `not-applied`: reconciliation proves the base still holds or the attempted creation is absent; the draft is recoverable and no mutation is submitted automatically;
8. `superseded`: an explicit resolution created a replacement operation and retained lineage to the original.

`settled` and deliberately discarded operations may be compacted after their drafts and locks are released. Unknown, conflicted, and not-applied operations remain durable until explicit resolution.

### Transition rules

- Save persists `prepared`, closes the editor, and publishes the optimistic projection in one local transaction. Dispatch follows only after persistence succeeds.
- Starting the process changes `prepared` to `in-flight`.
- A matching receipt changes `in-flight` directly to `settled`, replaces the projection with the canonical result, clears the durable draft, and releases the record scope.
- A definite CLI rejection that performed no write returns the operation to recoverable/conflict handling without becoming unknown.
- A guard rejection enters `rebasing`; it either settles as already equal, creates a safely rebased guarded effect, or enters `conflicted`.
- An ambiguous process outcome enters `unknown`, retains projection and draft, and schedules reconciliation reads only.
- An observation started before a mutation or based on an older causal tag cannot roll back its optimistic or receipt-confirmed projection.
- A quiet observation equal to the settled canonical result refreshes freshness metadata only.

Record scopes use a known Time Entry or Active Timer identity. Creation uses a provisional scope keyed by operation ID plus its semantic creation class: Time Entry creation, Active Timer creation, or Timer Switch target. Only scopes that could duplicate or overwrite the unknown result are locked. This preserves unrelated work.

## Three-Way Merge and Deletion Rules

For base `B`, local intended result `L`, and verified current FreshBooks record `C`, the ledger compares each editable field group canonically:

| Local versus `B` | FreshBooks versus `B` | Result |
| --- | --- | --- |
| unchanged | unchanged | keep `C` |
| changed | unchanged | take Mine |
| unchanged | changed | take FreshBooks |
| changed | changed to the same canonical value | take that value; no conflict |
| changed | changed to a different canonical value | present Mine/FreshBooks for this group |

All non-overlapping groups are merged before the view is published. The user sees choices only for divergent overlapping groups, and each choice updates that group. After every choice, the ledger recomputes the complete valid canonical intent. Choosing Mine creates a new guarded operation against the latest verified current token. Choosing FreshBooks adopts the current group. If FreshBooks changes again before the replacement mutation, the same merge runs again; an old choice is never applied unguarded.

Structural `timer-state` transitions are merged conservatively. An already-achieved requested state settles. A remote state change that makes the requested transition invalid is a field conflict, not a blind command replay. Timer Segment representation differences that preserve the same logical Active Timer are canonical equality.

Deletion is explicit:

- `C` deleted and local unchanged: accept deletion and close the draft.
- `C` deleted and local changed: show **Restore as new** and **Discard local**.
- **Restore as new** creates an operation with an absent base, a new provisional scope, and editable semantic values from the local intent. A deleted Time Entry is recreated through normal Time Entry creation; a deleted Active Timer is restored through normal Active Timer start. Both omit the deleted identity and revalidate assignment-derived fields through the CLI.
- **Discard local** accepts deletion, clears the draft, and releases the scope.
- A local delete against externally edited `C` is a `timer-state`/existence conflict: the user chooses deletion (Mine) or retention (FreshBooks) against the latest guard.

## Unknown Outcomes and Restart

An outcome is unknown only when the process interface cannot prove whether a mutation crossed the FreshBooks write seam. Declared validation errors, guard rejections, permission errors received before a write, and successful receipts are known outcomes.

On `unknown`, the coordinator removes queued duplicate effects for the affected scope but does not remove unrelated effects. It schedules canonical reconciliation with interactive priority. It never resubmits the mutation.

Semantic reconciliation uses the persisted base, intended result, affected identity, and creation baseline:

- update: current equals intended semantics → `settled`; current equals base → `not-applied`; any other current record → three-way merge;
- delete: record absent → `settled`; record equals base → `not-applied`; changed record → deletion conflict;
- create: exactly one identity absent from the pre-dispatch baseline matches the canonical creation intent → `settled`; no matching new identity after a successful authoritative read → `not-applied`; multiple matches or insufficient query coverage remain `unknown` and blocked;
- timer transition: the canonical logical Active Timer or resulting Time Entry proves the intended state → `settled`; the canonical base still holds → `not-applied`; any other state is merged or conflicted by field group;
- Timer Switch: reconcile log and start phases separately. The old timer logged with no new timer is a confirmed partial result, not total failure; a matching new Active Timer completes settlement.

Token equality may accelerate a branch but cannot replace semantic comparison. Reconciliation reads must cover deleted records when needed and must have sufficient date/timer scope to prove absence.

The ledger file lives in Quickshell’s state directory, is versioned, and is written atomically. On startup, the ledger loads before ordinary refresh effects are emitted. It restores optimistic projections, drafts, per-record locks, and unknown/conflict views, then requests canonical reconciliation. Cached remote data may paint as stale but cannot settle an operation. Corrupt or unsupported ledger data produces a persistent recovery error and preserves the unread file; it does not discard drafts or issue mutations.

## Request Coordinator Behavior

The coordinator schedules one CLI process at a time because the adapter has capacity one.

Priority is:

1. interactive mutation or explicit conflict resolution;
2. reconciliation for unknown or partial outcomes;
3. visible-view reads;
4. coalesced quiet refreshes.

Within a priority, causal order is preserved for the same record scope. Unrelated scopes may overtake queued quiet reads but still execute serially at the adapter.

Every request has an ID, scope, kind, priority, enqueue sequence, and causal tag supplied by the ledger. Every completion returns those tags. The coordinator rejects a completion from a canceled process, a superseded read, or an older generation for the same query key. The ledger additionally rejects observations whose causal tag predates a relevant operation.

Queued reads are keyed by semantic query: timer status, project list, recent entries, or Time Entry date/range. A newer equivalent read replaces an older queued read. A broader queued read may subsume a narrower one only when it returns all records and deletion information the narrower consumer requires.

When an interactive mutation arrives:

- a queued superseded read is dropped;
- an active read-only CLI process may be terminated and, after the existing grace interval, killed if necessary;
- the canceled read completion is stale and has no semantic effect;
- an active mutation is never canceled to improve responsiveness;
- a mutation queued behind another mutation retains causal order for overlapping scopes.

Timeouts are operation-aware. `freshbooks-cli` defines bounded legitimate budgets for read, single-write, multi-segment, log, and switch workflows, including network timeout, one authentication replay, bounded rate-limit waits, and sequential write count. Diagnostics exposes those maximum command budgets as part of the versioned CLI contract. The coordinator’s outer deadline selects the command’s class and adds process startup plus termination-handoff grace. Therefore the plugin never times out a command while the CLI is still within a legitimate documented retry budget. Exceeding the outer deadline cancels a read or marks a mutation unknown; it never triggers a mutation retry.

## Optimistic QML Flow

1. The editor sends one save intent containing record identity, base operation/version reference, and the local field-group patch.
2. The ledger validates the intent, durably records the operation and draft, computes the optimistic projection, and publishes a new immutable view.
3. QML closes the editor immediately and renders that view. A subtle per-record settling state may be shown, but the rest of the panel remains usable.
4. The coordinator dispatches the ledger effect.
5. A receipt replaces the optimistic record with the canonical result without reopening the editor or showing a conflict.
6. A non-overlapping verified external change produces an automatically merged projection and guarded effect.
7. Divergent same-field changes produce field rows with Mine/FreshBooks choices. Unconflicted fields remain resolved and visible.
8. Unknown state shows recovery status and blocks actions only for the affected record scope. The original draft can be reopened from that record.
9. Remote deletion with local edits presents Restore as new or Discard local.

All visible state comes from one immutable ledger view. QML delegates may hold transient focus/input text while open, but once an intent is accepted they do not mutate service records directly. The one-second display clock projects elapsed duration from the canonical anchor and current time; it does not write ledger state, advance tokens, or imply FreshBooks confirmation.

## Performance and Request Reduction

Mutation receipts are the settlement fast path. The plugin adopts them immediately and schedules any ordinary post-mutation refresh as a quiet, coalescible read. No successful mutation requires an immediate read solely to obtain the state it just returned.

The CLI command-scoped tracking context reuses canonical records already fetched for guards and workflows:

- guarded Time Entry update/delete performs one detail read and one write/delete, with no confirmation read;
- pause/resume/correction performs one Active Timer discovery, the required segment write(s), and constructs the receipt from confirmed responses plus the tracked context;
- log reuses the discovered timer and its segments rather than rediscovering them during pause/log phases;
- Timer Switch reuses the log workflow’s fetched timer, segment, project, service, and ability records, then reports both phases in one receipt;
- independent GETs such as identity, project metadata, and other prerequisite reads execute concurrently inside the CLI when neither result determines whether the other request is safe;
- writes and reads that establish a guard or feed a later write remain sequential.

Request-count contract tests assert these ceilings for one-segment and multi-segment fixtures and fail on redundant status/detail/confirmation reads. Plugin tests assert that a successful receipt causes zero mandatory follow-up reads, multiple quiet refresh requests coalesce to one, superseded queued reads do not start, and an interactive mutation safely cancels an active read.

## Migration and Clean Cutover Across Both Repositories

Implementation is phased for review, but all phases ship as one compatible coordinated plan with no deferred behavior.

### Phase 1: `freshbooks-cli` canonical contract

- Add the canonical tracking module and contract version.
- Route list, detail, timer-segment aggregation, guard rejection, and every mutation result through it.
- Replace bare mutation results with receipts and canonical current state on guard rejection.
- Add command-scoped fetched-record reuse, safe independent GET parallelism, and documented command-budget diagnostics.
- Update CLI contract, guard, receipt, representation, and request-count tests.

### Phase 2: plugin ledger and coordinator

- Add the persistent operation ledger behind its intent/observation/effect/view interface.
- Move drafts, optimistic projection, semantic merge, receipt settlement, unknown recovery, and record-scoped locks out of the current service request callbacks.
- Refactor the existing queue into the request coordinator and add priority, query supersession, read cancellation, causal tags, and operation-aware deadlines.
- Adapt the CLI response seam to require the new contract version and receipt shapes.

### Phase 3: QML cutover

- Replace direct mutation helpers, snapshot-conflict flags, Reload/Apply Mine flow, and mutable view-specific drafts with ledger intents and the immutable ledger view.
- Render field-level Mine/FreshBooks choices, restore/discard deletion recovery, per-record unknown state, and immediate optimistic results.
- Keep per-second ticking as a view projection.

### Phase 4: remove obsolete paths and release together

- Remove old raw snapshot helpers, global unknown/conflict blocking, unconditional post-mutation refreshes, unguarded Apply Mine behavior, and legacy mutation response parsing.
- Migrate every command caller, fake adapter, fixture, test, README contract statement, and minimum compatible CLI version.
- Release `freshbooks-cli` first, then set the plugin’s exact new minimum compatible version before plugin release. The plugin refuses the old contract through diagnostics rather than probing or falling back.

No compatibility aliases, dual receipt/bare-record parsing, or old snapshot UI remain after cutover.

## Errors and Safety Invariants

- FreshBooks is authoritative, but only canonical causally admissible observations may replace newer ledger knowledge.
- The CLI adapter has exactly one caller: the request coordinator.
- The coordinator has no semantic conflict policy.
- QML has no mutation queue or settlement policy.
- A mutation is durable before it is dispatched.
- A draft is not cleared until receipt settlement, semantic reconciliation, or explicit discard.
- A semantic token is derived only from canonical state.
- No token mismatch alone is a user conflict.
- A guard rejection guarantees no write occurred.
- An unknown mutation is never auto-retried.
- A mutation process is never canceled for priority.
- A stale or canceled read completion cannot alter the ledger view.
- A record-scoped lock cannot disable unrelated records or read-only navigation.
- Restore after remote deletion creates a new identity.
- Timer Switch never starts the next Active Timer until the prior log is confirmed; a confirmed log plus failed start remains visible as a partial result.
- Mutation receipts never claim state unsupported by confirmed FreshBooks responses.
- Invalid JSON, response schema mismatch, oversized output, signal exit, and outer timeout on a mutation are unknown unless the CLI supplied a valid known-outcome error or receipt before exit.
- Authentication, validation, permission, and definite guard failures remain known failures and preserve the draft without pretending a write occurred.
- Persistent files contain canonical operation/draft data only, never OAuth tokens, headers, or raw FreshBooks payloads.

## Verification

### `freshbooks-cli` contract tests

- Feed semantically identical list, detail, timer-segment, and mutation payloads with different raw ordering, missing/null aliases, and representation quirks; assert equal canonical records and tokens.
- Change each semantic field group independently; assert token and canonical equality change exactly when semantics change.
- Assert running wall-clock advancement alone does not change the token.
- Assert guard rejection performs no write and returns the complete canonical current record or deleted marker.
- Assert create, update, delete, pause, resume, Duration Correction, log, and Timer Switch return complete receipts with correct identities and before/after tokens.
- Assert Timer Switch partial receipts report confirmed log state without inventing a new Active Timer.
- Assert request counts and fetched-record reuse for list/detail, one- and multi-segment timers, log, and switch. Assert only independent GETs overlap.

### Ledger tests

Use the ledger interface with deterministic canonical records and effects:

- plugin-owned receipt followed by delayed or reordered pre-mutation observations settles silently and never rolls back;
- equivalent records with different token versions/representations do not conflict after canonical comparison;
- verified non-overlapping remote edits auto-merge and emit one new guarded effect;
- same-field divergent edits expose only the overlapping field groups and apply Mine/FreshBooks choices against the latest current record;
- same-field same-value edits settle without a choice;
- remote deletion plus local edit offers restore-as-new/discard-local and never reuses the deleted identity;
- timeout, signal, invalid response, and restart retain draft/projection, lock only the affected scope, and emit reads but no mutation retry;
- semantic reconciliation classifies applied, not-applied, changed, partial switch, unique create match, absent create, and ambiguous duplicate matches;
- records unrelated to unknown/conflicted operations remain mutable;
- periodic and delayed reads cannot erase optimistic or receipt-confirmed state;
- all Time Entry and Active Timer transitions—create, update, delete, start, pause, resume, Duration Correction, note update, log, discard, and Timer Switch—exercise receipt, conflict, and unknown paths.

### Coordinator tests

- Capacity never exceeds one.
- Interactive mutations outrank queued reads without canceling a mutation.
- A running read is canceled safely for an interactive mutation; its completion is ignored.
- Equivalent queued reads coalesce and newer/broader admissible reads supersede older ones.
- Causal ordering is preserved for overlapping scopes.
- Outer deadlines exceed each CLI-advertised legitimate budget and hand mutation timeout to the ledger as unknown.

### QML runtime smoke

Run the real plugin under Omarchy/Quickshell with a deterministic CLI adapter and observe:

- Save closes the editor immediately and paints the optimistic timer/entry result.
- Successful settlement does not flash a false conflict or revert through a periodic read.
- Field-level Mine/FreshBooks choices are usable by pointer and keyboard.
- Remote deletion offers Restore as new and Discard local.
- Restart restores an unknown operation and its draft, blocks only its record, and reconciles without a mutation retry.
- The timer continues to tick visually between observations without changing ledger state.

## Acceptance Criteria

1. Equivalent FreshBooks resource meanings normalize to one versioned canonical record and semantic token across list, detail, timer-segment, guard, and mutation paths.
2. Every successful mutation returns a receipt with affected identity, before/after semantic tokens, and sufficient canonical result state for direct settlement.
3. Every guard rejection returns canonical current state and guarantees no mutation was issued.
4. Save closes immediately, the immutable ledger view renders the optimistic result, and the draft remains durable until settlement or explicit discard.
5. Plugin-owned changes settle silently; delayed, reordered, periodic, or representationally different observations do not create false conflicts or roll back newer state.
6. Verified non-overlapping external changes merge automatically. Same-field divergent changes present field-level Mine/FreshBooks choices against the latest verified state.
7. No token mismatch alone is treated as a user conflict.
8. Remote deletion plus local edit offers Restore as new or Discard local; restore never reuses the deleted identity.
9. Unknown outcomes persist across restart, reconcile semantically, block only the affected record/provisional scope, and never auto-retry the mutation.
10. Unrelated reads, navigation, and mutations remain enabled while another record is unknown or conflicted.
11. The request coordinator is the only capacity-one adapter caller, drops superseded queued reads, safely cancels only active reads for interactive mutations, rejects stale completions, and uses operation-aware outer deadlines longer than CLI retry budgets.
12. Successful receipts cause no mandatory post-mutation read; quiet refreshes coalesce; log and switch reuse fetched records; independent safe GETs run concurrently; request-count tests enforce the reduction.
13. QML sends intents, renders one immutable ledger view, and limits per-second ticking to presentation projection.
14. Every old snapshot-conflict, global-blocking, bare mutation result, unguarded Apply Mine, and unconditional refresh path is removed; both repositories require only the new contract.
15. Canonical contract, ledger, coordinator, request-count, and real QML smoke verification covers all specified Time Entry and Active Timer transitions and recovery paths.
