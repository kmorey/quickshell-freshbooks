# `freshbooks-cli` time-tracking surface audit

Audited on 2026-09-01 against the public [`v0.1.0` release](https://github.com/kmorey/freshbooks-cli/releases/tag/v0.1.0), commit [`d962568f4d0cbc7cbff5a6b65b91a0d44895557f`](https://github.com/kmorey/freshbooks-cli/tree/d962568f4d0cbc7cbff5a6b65b91a0d44895557f). The local checkout matched `origin/main` and the release tag. `npm test` (8 test files) and `npm run check` both passed during the audit.

## Conclusion

Version 0.1.0 is already a credible exclusive integration boundary for an Omarchy/Quickshell client: it has FreshBooks-backed timer start/status/log/discard, complete logged Time Entry CRUD, active-project discovery, OAuth token rotation safe across CLI processes, and a one-line JSON envelope. FreshBooks remains authoritative because an Active Timer is an unlogged FreshBooks Time Entry, not local plugin state. These behaviors are documented in the [project README](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/README.md#L1-L158) and covered at the service/output boundaries by [timer tests](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/test/freshbooks.test.js#L46-L120) and [JSON-envelope tests](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/test/output.test.js#L10-L29).

It is not yet sufficient for the agreed plugin without CLI changes. The hard gaps are:

1. no client-list command;
2. pause and resume deliberately return `UNVERIFIED_TIMER_OPERATION`;
3. no verified operation that corrects a running timer's duration while keeping it running;
4. no first-class, failure-described Timer Switch;
5. no conflict token or compare-before-write contract for detecting a remote edit underneath a local form;
6. stable outer JSON but raw, inconsistent, unversioned inner resource shapes; and
7. no bounded recent-project query, request timeout, or cancellation contract suitable for a long-lived shell UI.

The calendar, daily/weekly aggregation, keyboard interaction, and recency ordering can live in the plugin once the CLI supplies normalized clients/projects/entries and bounded history. They do not require direct FreshBooks API access from QML.

## Current command surface

The executable dispatches only `auth`, `business`, `projects`, `timer`, and `time`; its complete public help is in [`src/cli.js`](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/cli.js#L18-L69) and [the help block](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/cli.js#L362-L389).

| Area | Commands and behavior in v0.1.0 | JSON `data` today | Plugin assessment |
| --- | --- | --- | --- |
| Authentication | `auth configure`, `auth url`, `auth login`, `auth status`, `auth logout` | Purpose-specific objects; status includes `configured`, `authenticated`, profile, credential backend/warning, token expiry, and selected business ID | Adequate for setup diagnostics. Login is interactive unless `--code` is supplied. The plugin should not own or inspect credentials. |
| Business | `business list`; `business use ID` | Normalized business objects with `id`, `name`, `accountId`, `role`, and `active` | Adequate for a single configured business. `business use` persists only the business ID. |
| Clients | None | None | Blocking gap for client labels, client search, and disambiguating equal project names. |
| Projects | `projects list [--all]` | Array of raw FreshBooks project objects | Fetches all pages. By default requests active, incomplete projects; `--all` removes those filters. Good data source, but the machine shape should be normalized and joined with client labels. |
| Timer | `timer status`; `timer start`; `timer log [ENTRY_ID]`; `timer discard [ENTRY_ID] --yes` | Status is normalized; start returns one normalized timer; log returns a raw Time Entry plus computed elapsed fields; discard returns `{id, deleted}` | Start/status/log are usable. Pause/resume, correction, safe switching, and conflict detection are not. |
| Time Entries | `time list`; `time add`; `time update ENTRY_ID`; `time delete ENTRY_ID --yes` | Raw FreshBooks Time Entry arrays/objects, except delete | CRUD is present. A `time get` command, normalized shape, local-date boundary contract, and compare-before-write support are still needed for robust editing. |

### Businesses, projects, and clients

`business list` derives both FreshBooks business ID and accounting account ID from the identity response, but `business use` persists only `businessId` ([service implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L11-L62)). This distinction matters: projects use `/projects/business/<business_id>/...`, while the official client list uses `/accounting/account/<accountId>/users/clients` ([FreshBooks Projects API](https://www.freshbooks.com/api/project), [FreshBooks Clients API](https://www.freshbooks.com/api/clients)). A new clients command therefore needs to retain or rediscover `accountId`; it cannot substitute `businessId`.

`projects list` paginates in batches of 100 and requests `active=true&complete=false` unless `--all` is present ([implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L64-L84)). FreshBooks project records include `title`, `client_id`, `active`, `complete`, services, and timestamps, but the CLI currently passes the entire API object through rather than declaring a plugin-facing schema. There is no project get command even though an internal project lookup is used to infer `client_id` when creating or moving a Time Entry.

### Time Entries

`time list` accepts `--from`, `--to`, `--project`, and an implemented-but-undocumented `--include-unlogged`; it retrieves every matching API page. `time add` requires duration and accepts start time, project, client, service, note, and billability. `time update` accepts the same editable fields and first fetches the current record so required fields survive FreshBooks' non-partial PUT behavior. Delete requires `--yes` ([CLI implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/cli.js#L262-L327), [service implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L86-L144)).

FreshBooks defines duration in seconds, `is_logged=false` for a Time Entry created from a running timer, `include_unlogged=true` for in-progress timers, and UTC-inclusive `started_from`/`started_to` filters ([official Time Entries API](https://www.freshbooks.com/api/time_entries)). The current parser converts all supplied dates through JavaScript `Date` and sends ISO instants. A bare `YYYY-MM-DD` becomes UTC midnight, not a guaranteed FreshBooks-local day boundary ([date parsing](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/format.js#L31-L41)). For Sunday–Saturday reporting, the plugin must either pass explicit offset-bearing boundaries and handle the inclusive endpoint, or the CLI should add a documented local-date query.

There is no `time get ENTRY_ID`. Editing can use the object returned from `time list`, but re-opening or reconciling one selected entry requires listing again or adding this small command.

### Active Timer behavior

The CLI discovers timers by making one bounded request for up to 100 Time Entries with `include_unlogged=true`, filters entries where `is_logged === false` or `timer.is_running === true`, and presents each as:

```json
{
  "id": 900,
  "timerId": 901,
  "running": true,
  "isLogged": false,
  "startedAt": "2026-09-01T15:00:00.000Z",
  "elapsedSeconds": 0,
  "elapsed": "0s",
  "projectId": 44,
  "clientId": 55,
  "serviceId": null,
  "note": "Build shell plugin",
  "billable": null
}
```

Undefined optional properties are omitted by `JSON.stringify`; `null` above is illustrative, not guaranteed. The discovery and presentation logic is in [`src/freshbooks.js`](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L146-L183) and [`presentTimer`](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L251-L268).

`timer start` refuses to add another unlogged timer unless `--force` is passed. It creates a Time Entry with `is_logged=false`, `duration=0`, and `started_at=now`; it fills identity ID and infers client ID from the project when necessary. This is the correct FreshBooks-backed continuity model ([start implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L185-L207)). The plugin must never use `--force`, because the product model permits one Active Timer.

`timer log` requires either exactly one discovered timer or an explicit Time Entry ID. It computes elapsed duration, PUTs the existing record as logged with the timer ID, and returns the updated Time Entry. `timer discard` deletes the Time Entry and requires confirmation ([finalization implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L153-L173), [log/discard implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L209-L223)). More than one discovered timer produces `MULTIPLE_ACTIVE_TIMERS` unless an ID is supplied.

Pause and resume are explicitly stubs. Either command returns exit 2 and `UNVERIFIED_TIMER_OPERATION` because the public FreshBooks reference shows `timer.id` and `timer.is_running` and shows a timer ID when logging, but does not document pause/resume request payloads ([CLI behavior](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/cli.js#L204-L259), [official Time Entries API](https://www.freshbooks.com/api/time_entries)). Live-account protocol validation is therefore a prerequisite to implementing these operations safely.

The generic `time update` may send a new duration or note to an unlogged Time Entry, but it is not a validated Duration Correction. It does not express “replace elapsed duration and continue running,” does not carry the timer object from the command layer, and the local presenter computes a running value as the greater of server duration and wall-clock time since `started_at`; a downward correction can therefore remain invisible locally ([writable fields](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/freshbooks.js#L225-L247), [elapsed calculation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/format.js#L43-L51)). Duration Correction needs its own live-validated timer operation and regression tests.

## Machine-readable and process contract

`--json` produces exactly one newline-terminated object. A success is written to stdout as `{ "ok": true, "data": ... }`; an error is written to stderr as `{ "ok": false, "error": { "code", "message", "status"?, "details"? } }` ([output implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/output.js#L3-L40)). This is well suited to `QProcess`, with two caveats:

- `auth status --json` deliberately writes an `ok:true` status object but exits 4 when unauthenticated. Consumers must read `data.authenticated` for this diagnostic command rather than equating every nonzero exit with an error ([auth status](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/cli.js#L147-L163)).
- Only the envelope is stable. Project and Time Entry payloads are raw FreshBooks objects, while timers use camelCase and `timer log` mixes a raw object with `elapsed_seconds`/`elapsed`. There is no schema version or minimum-consumer contract.

Current exit meanings follow the error classes and command sites ([error implementation](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/errors.js#L1-L23)):

| Exit | Meaning in v0.1.0 | Representative codes |
| --- | --- | --- |
| 0 | Successful command | success envelope |
| 1 | Default local/domain/unexpected failure | `CLI_ERROR`, `UNEXPECTED_ERROR`, `CONFIG_ERROR`, `SECRET_STORE_ERROR`, `BUSINESS_REQUIRED`, `TIMER_ALREADY_ACTIVE`, `NO_ACTIVE_TIMER`, `MULTIPLE_ACTIVE_TIMERS` |
| 2 | Invocation, validation, confirmation, or intentionally unavailable operation | `INVALID_ARGUMENT`, `UNKNOWN_COMMAND`, `CONFIRMATION_REQUIRED`, `AUTH_CODE_REQUIRED`, `UNVERIFIED_TIMER_OPERATION` |
| 3 | FreshBooks HTTP/API failure other than 401 | `API_ERROR` or `AUTH_TOKEN_ERROR`, with HTTP `status` when known |
| 4 | Authentication required or an API 401 after retry; also unauthenticated `auth status` | `AUTH_REQUIRED`, API error with status 401 |

Not every exit-2 path sets a specific code; some inherit `CLI_ERROR`. A plugin should primarily branch on documented error code and use exit class only as a fallback. Unknown exceptions are converted to `UNEXPECTED_ERROR` rather than escaping as non-JSON output.

The HTTP client refreshes a token up to 60 seconds before expiry, retries one rejected access token after refreshing under a cross-process lock, and retries HTTP 429 at most three times using a clamped 1–10 second `Retry-After` delay ([HTTP client](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/api.js#L13-L92), [refresh lock](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/auth.js#L106-L135)). There is no fetch timeout, cancellation signal, or stable error code for timeout/offline/DNS conditions. Because the shell is long-lived, the plugin needs either a CLI-level timeout option/code or a carefully bounded `QProcess` timeout and kill policy.

## Authentication and configuration

The CLI requires a FreshBooks OAuth application, HTTPS redirect URI, client ID, client secret, the scopes listed in the README, and one selected business. `auth login --json` refuses to prompt and requires `--code`, which keeps the shell integration noninteractive ([auth command](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/cli.js#L72-L170)).

Non-secret configuration is stored atomically in `${XDG_CONFIG_HOME:-~/.config}/freshbooks-cli/config.json`; it includes the selected business and profile. Overrides exist for client ID, redirect URI, business ID, profile, API base, and auth base ([configuration store](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/config.js#L6-L65)).

Secrets use Secret Service through `secret-tool`. If unavailable, one profile falls back to `credentials.json` with mode `0600` and stays on that backend so refresh-token rotation does not split state between stores ([secret store](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/secrets.js#L7-L122), [fallback persistence test](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/test/secrets.test.js#L7-L62)). The plugin should invoke `auth status --json` for diagnostics and direct the user to terminal setup; it should never read the files or keyring.

## Exact CLI gaps for the planned plugin

### Required before the first usable release

1. **Normalized client discovery.** Add `clients list --json` (and optionally `clients get ID`) using the selected business's accounting `accountId`. Return a declared compact shape such as `{id, organization, firstName, lastName, displayName, active}`. This unblocks client labels and project/client search.

2. **Verified timer pause/resume.** Replace the stubs with live-account-validated `timer pause [ENTRY_ID]` and `timer resume [ENTRY_ID]`. Each successful response must return the full normalized Active Timer after FreshBooks confirms the transition. Repeated pause/resume should be either idempotent or return a distinct documented state error.

3. **Verified Active Timer mutation.** Add a timer-specific mutation, for example `timer update [ENTRY_ID] --duration ... --note ...`, that supports the agreed Duration Correction: FreshBooks reflects the replacement duration, the timer remains running, and subsequent status rebases elapsed time correctly. Commit-on-Enter/focus-loss belongs in QML, but confirmation/rejection and returned authoritative state belong in the CLI.

4. **A safe Timer Switch contract.** Prefer `timer switch --project ID [--note TEXT]` over two opaque child processes. It must log the current running or paused Active Timer first, start the new one only after confirmed finalization, and return both the logged Time Entry and new Active Timer. If the log fails, return a code such as `TIMER_SWITCH_LOG_FAILED`, do not start anything, and include the still-authoritative timer. If logging succeeds but start fails, return an explicit partial-result error such as `TIMER_SWITCH_START_FAILED` with the logged entry so the plugin does not pretend the old timer still exists. FreshBooks cannot make two HTTP calls transactional, so truthful phase reporting is the safety property.

5. **Compare-before-write reconciliation.** Add a deterministic snapshot token to normalized Active Timer and Time Entry reads, and accept it on update/log/pause/resume/delete. Immediately re-read and reject with a documented `REMOTE_STATE_CHANGED` plus authoritative record when relevant fields no longer match. This implements the agreed “Changed in FreshBooks: Reload or Apply Mine” UX without requiring undocumented API ETags. Without it, `updateTimeEntry` fetches the latest record and silently overlays the local patch, so same-field remote edits are last-write-wins.

6. **Versioned inner JSON schemas.** Keep the existing envelope, but stop leaking raw API payloads to QML. Define normalized `Client`, `Project`, `TimeEntry`, and `ActiveTimer` records with documented required/nullable fields and one naming convention. Add a contract/schema version or establish these shapes as SemVer-protected from the first plugin-compatible release. Preserve machine-readable error codes and return authoritative post-mutation records.

7. **A bounded process contract.** Add request timeout handling with a stable `NETWORK_TIMEOUT` code (and preferably a CLI timeout option), while retaining bounded 429 behavior. Document that no prompt or human prose can appear in JSON mode. This prevents one stalled FreshBooks request from leaving an indeterminate spinner in the shell.

### Needed for the full project/calendar experience, but not FreshBooks protocol blockers

8. **Normalized projects joined to clients.** `projects list` should expose at least `{id, title, clientId, clientName, active, complete, serviceIds}`. The UI can then search project and client names without joining raw resources in QML.

9. **Bounded recent-project history.** Add a bounded query such as `projects recent --limit N` or support `time list --limit/--sort` well enough to compute last use without downloading an account's full history. Ranking must use FreshBooks history, not plugin-only state. Frequency ranking and pins can wait.

10. **Single-entry read and explicit local-date semantics.** Add `time get ENTRY_ID`. Either add `time list --date YYYY-MM-DD`/local date-range support or document how offset-bearing bounds and the API's inclusive `started_to` behave so adjacent calendar days cannot double-count an entry at midnight.

11. **Project-derived billability verification.** The initial plugin should never send manual billability flags. Validate with a real account that omitting `billable` produces the project's intended setting; if FreshBooks does not inherit it, the CLI must derive the correct value from project/service data. The current CLI merely passes an optional boolean through and does not enforce inheritance.

12. **Document exceptional multi-timer recovery.** Keep `timer status` capable of returning multiple timers created elsewhere, and keep ID-targeted log/discard. Define how pause, resume, correction, and switch behave in this recovery state. The plugin should surface recovery rather than silently selecting one.

### No CLI addition is required for

- local ticking between `timer status` polls;
- refresh on popup focus and roughly every 15 seconds while visible;
- Sunday–Saturday daily and weekly totals once date boundaries are explicit;
- calendar entry indicators and aggregation;
- plugin-side drafts, focus management, keyboard navigation, or quiet-success/persistent-error presentation; and
- recent-project caching for startup, provided FreshBooks-derived ordering replaces it after refresh.

## Compatibility recommendation

Treat v0.1.0 as the audited baseline, not as a plugin-compatible minimum. Ship the required contract changes as the next release (recommended `v0.2.0` while the package remains pre-1.0), make `freshbooks --version --json` part of plugin startup diagnostics, and have the plugin require the first version containing the normalized schemas and timer operations. Do not infer support by probing commands: an explicit minimum version makes support and error reporting predictable. The package already declares Node.js 22+ and exposes its version in both package metadata and `--version` ([package metadata](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/package.json#L1-L32), [version dispatch](https://github.com/kmorey/freshbooks-cli/blob/d962568f4d0cbc7cbff5a6b65b91a0d44895557f/src/cli.js#L15-L34)).

The plugin can remain CLI-only. All identified gaps can be implemented inside the user-owned `freshbooks-cli` repository while keeping OAuth, FreshBooks HTTP, retries, and resource normalization out of QML.
