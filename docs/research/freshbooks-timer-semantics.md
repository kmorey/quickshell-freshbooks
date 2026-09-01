# FreshBooks timer semantics

Research date: 2026-09-01

## Executive answer

FreshBooks exposes timers through the same `/timetracking/business/{business_id}/time_entries` resource used for completed Time Entries. The documented state markers are `is_logged`, `duration`, `started_at`, and the nested `timer` object (`id`, `is_running`). A running timer is discoverable by listing with `include_unlogged=true`; logging is demonstrated as a `PUT` that makes the entry logged and supplies its final duration. Completed entries can be created, read, replaced, and deleted through the same resource. [FreshBooks Time Entries API](https://www.freshbooks.com/api/time_entries)

The public contract is incomplete for this product. FreshBooks' own UI supports pause/resume, but neither the API reference nor the official Postman collection publishes pause or resume requests. They also do not specify how to correct a timer's duration while it remains running, how concurrent remote edits are detected, whether timers are split at midnight, or whether creating an entry without `billable` reliably derives billability from every project configuration. Those behaviors require live-account characterization before the CLI can promise them. [FreshBooks timer help](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time), [FreshBooks official Postman collection](https://www.postman.com/fresh-books/freshbooks-s-public-workspace/documentation/bjkevg4/freshbooks-api?entity=request-3322108-ae5540f2-f8bb-453b-b5b2-ee8c05b47a17)

## Evidence status

This report uses these labels deliberately:

- **Documented**: stated or demonstrated by current FreshBooks API/help documentation.
- **Design inference**: a safe client policy derived from documented primitives, not a FreshBooks guarantee.
- **Unspecified**: no authoritative public behavior was found; implementation must not silently assume one.

## Resource and state model

### Documented fields

A Time Entry has a UTC `started_at`, integer `duration` in seconds, `is_logged`, client/project/service identifiers, note, billability fields, and an optional nested timer. FreshBooks describes `is_logged=false` as an entry created from a running timer. The nested timer response exposes `id` and `is_running`. The official Node SDK models the same fields and treats `isLogged`, `startedAt`, and `duration` as required request-model values. [Time Entries API](https://www.freshbooks.com/api/time_entries), [official SDK `TimeEntry` model](https://github.com/freshbooks/freshbooks-nodejs-sdk/blob/91cfeeeddda5c5d1dc7a7d66fd689aa4c3664f93/packages/api/src/models/TimeEntry.ts), [official SDK `Timer` model](https://github.com/freshbooks/freshbooks-nodejs-sdk/blob/91cfeeeddda5c5d1dc7a7d66fd689aa4c3664f93/packages/api/src/models/Timer.ts)

The API's ordinary list excludes in-progress timers unless `include_unlogged` is requested. `updated_since` can select changed entries and `include_deleted` can include deletions. [Time Entries API filters](https://www.freshbooks.com/api/time_entries)

### Usable state classification

| State | Public evidence | Confidence |
| --- | --- | --- |
| Running | `is_logged=false`; reference examples also show `timer.is_running=true`. | Documented |
| Paused but not logged | FreshBooks' duration-format UI supports pausing and later resuming, but no API response example defines the state tuple. `is_logged=false` plus `timer.is_running=false` is plausible, not proven. | Unspecified |
| Logged | `is_logged=true`, a final `duration`, and a non-running or absent timer. | Documented |
| Deleted | `DELETE` returns `204 No Content`; deleted records can be queried with `include_deleted`. | Documented |

`timer.is_running=false` alone cannot mean “paused”: FreshBooks' own API example returns a logged entry with a timer whose `is_running` is false. State classification must consider `is_logged` and the timer together. [Time Entries API examples](https://www.freshbooks.com/api/time_entries)

The API documentation does **not** establish a global one-timer invariant. Its `updated_since` example contains three different unlogged entries whose timers are all running. Therefore the plugin's “one Active Timer” rule is a product invariant, and the CLI must detect and report multiple candidates rather than silently selecting one. [Time Entries API updated-since example](https://www.freshbooks.com/api/time_entries)

## Starting, pausing, resuming, and logging

### Start

**Documented:** a running timer is represented by creating an unlogged Time Entry (`is_logged=false`), and it can subsequently be retrieved with `include_unlogged=true`. The public page defines the fields but does not provide a complete timer-start request example. [Time Entries API](https://www.freshbooks.com/api/time_entries)

**Current CLI-compatible request to validate:** `POST` an entry containing at least the authenticated identity, `is_logged=false`, UTC `started_at`, `duration=0`, and the chosen project/client/service metadata. This matches the resource model, but required fields and server defaults for an unlogged create should be included in the live test matrix below.

FreshBooks says its web timer continues across navigation and browser closure until Pause, Log Time, or Discard is selected. That confirms server-backed continuity at the product level; a shell restart must therefore reload FreshBooks state rather than rely on a local stopwatch. [FreshBooks timer help](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time)

### Pause and resume

**Documented product behavior:** pause/resume exists only when the account's tracking format is Duration. Under Start and End Time format, FreshBooks provides no pause button; using Play on a logged entry creates a separate entry. [FreshBooks timer help](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time)

**Unspecified API behavior:** the public API reference and official Postman collection expose no pause or resume endpoint and no `PUT` payload for transitioning `timer.is_running`. The official Node SDK's timer is response-only: the Time Entry request transform does not serialize the nested timer at all, even though the API reference's completed-entry update example includes a timer ID. [official SDK `TimeEntry` request transform](https://github.com/freshbooks/freshbooks-nodejs-sdk/blob/91cfeeeddda5c5d1dc7a7d66fd689aa4c3664f93/packages/api/src/models/TimeEntry.ts), [official Postman Time Tracking folder](https://www.postman.com/fresh-books/freshbooks-s-public-workspace/documentation/bjkevg4/freshbooks-api?entity=request-3322108-ae5540f2-f8bb-453b-b5b2-ee8c05b47a17)

Consequently, pause/resume cannot be specified from public documentation. The CLI should keep those commands behind live-account validation instead of emulating pause locally: a local-only pause would diverge from the FreshBooks timer visible in web/mobile.

### Log a timer into a Time Entry

**Documented:** FreshBooks demonstrates `PUT /time_entries/{time_entry_id}` with `is_logged=true`, an explicit final `duration`, the original `started_at`, client/project fields, and the timer ID. The response remains the same Time Entry ID, reports `is_logged=true`, and shows the timer as non-running. The endpoint response is the confirmation boundary. [Time Entries API update example](https://www.freshbooks.com/api/time_entries), [official Postman update example](https://www.postman.com/fresh-books/freshbooks-s-public-workspace/documentation/bjkevg4/freshbooks-api?entity=request-3322108-ae5540f2-f8bb-453b-b5b2-ee8c05b47a17)

FreshBooks' UI rounds a timer to whole minutes when it is logged: under 30 seconds rounds down and over 30 seconds rounds up. The API reference, however, accepts duration in seconds and does not say whether API-originated logging receives the same rounding. The CLI must characterize this instead of applying UI rounding and risking a double adjustment. [FreshBooks timer help](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time)

## Duration correction while active

FreshBooks documents updating `duration` on a logged entry and its Chrome extension allows users to adjust duration immediately before logging. It does **not** document changing `duration` while `is_logged=false` and allowing that corrected value to continue accumulating. [Time Entries API update example](https://www.freshbooks.com/api/time_entries), [FreshBooks Chrome timer help](https://support.freshbooks.com/hc/en-us/articles/115013039527-How-do-I-track-time-using-the-Chrome-time-tracker-extension)

The following are therefore **unspecified**:

- whether a `PUT` with `is_logged=false` and a replacement `duration` is accepted;
- whether the server rebases the running timer, ignores the value, pauses it, or resets its anchor;
- whether the nested timer ID or another timer field must be supplied;
- how a correction behaves after one or more pause/resume cycles;
- whether another FreshBooks client immediately sees the correction;
- whether corrections are rounded.

The required UX (“commit on Enter/blur and reflect the correction in FreshBooks”) depends on this characterization. Until verified, the CLI must not report a successful Duration Correction based only on a local offset.

## Timer switching

There is no documented FreshBooks “switch timer” operation. Logging an existing timer and creating a new unlogged entry are separate `PUT` and `POST` requests. [Time Entries API](https://www.freshbooks.com/api/time_entries)

The safe switching algorithm is a **design inference**:

1. Fetch the candidate Active Timer from FreshBooks and refuse ambiguity if more than one exists.
2. Log it with `PUT`.
3. Verify the response says `is_logged=true` (or re-read after an ambiguous transport failure).
4. Only then create the next timer with `POST`.
5. If logging is rejected, keep showing the old timer and do not issue the start request.

FreshBooks documents no transaction spanning these calls and no idempotency key for Time Entry creation. Thus a switch cannot be all-or-nothing: logging may succeed and the subsequent start may fail. The recoverable result is “old work safely logged, no new timer,” never “new timer started while the old result is unknown.” After a timeout, re-read before retrying either mutation to avoid duplicate entries.

## Remote changes and concurrency

FreshBooks provides three synchronization mechanisms:

- fetch the specific entry or list entries, including unlogged timers;
- query `updated_since` and `include_deleted` for incremental refresh;
- subscribe to `time_entry.create`, `time_entry.update`, and `time_entry.delete` webhooks. Webhooks can arrive seconds to minutes later and require a verified reachable callback, so they are not a dependable direct mechanism for a local Quickshell plugin. [Time Entries API filters](https://www.freshbooks.com/api/time_entries), [FreshBooks webhooks](https://www.freshbooks.com/api/webhooks)

The public Time Entry contract documents no revision field, ETag precondition, `If-Match`, compare-and-swap token, or merge semantics. A general `409 Conflict` exists in the FreshBooks error catalog, but the Time Entries section documents only 401/403/404 and does not promise conflict detection for stale entry writes. [FreshBooks errors](https://www.freshbooks.com/api/errors)

Therefore focus/open refresh and visible polling are sound client policies, but they do not make writes concurrency-safe. Before any mutation, the CLI should fetch the latest record and send a complete intended state; after every mutation, it should adopt the server response. The UI's “Changed in FreshBooks: Reload or Apply Mine” behavior is a product-level conflict guard for dirty local fields. If no field is dirty, remote state can be adopted automatically.

## Billability inheritance

The API exposes `billable` directly on Time Entries and allows callers to send it. Projects expose `project_type` and `billing_method`; Services expose their own `billable` setting. FreshBooks' product rules say flat-rate project Time Entries are automatically non-billable, while hourly-project entries may be billable or non-billable. Changing project type affects future entries but does not rewrite all prior entries. [Time Entries API](https://www.freshbooks.com/api/time_entries), [Projects API](https://www.freshbooks.com/api/project), [Services API](https://www.freshbooks.com/api/services), [FreshBooks billing-method rules](https://support.freshbooks.com/hc/en-us/articles/115005920788-What-are-billing-methods)

Thus “billability always matches the project setting” needs a precise implementation interpretation: omit manual billability controls, let FreshBooks apply its project/service rules, and display/use the `billable` value returned on the Time Entry. The public API does not guarantee the default when `billable` is omitted for every combination of hourly/flat-rate project and service, so creation behavior must be tested. The plugin should not infer a universal Boolean solely from `project_type`.

## Editing and deleting logged entries

**Documented:** `PUT /time_entries/{id}` can replace duration, note, UTC start, client, and project; the resource model also includes service and billability fields. `DELETE /time_entries/{id}` returns `204 No Content`. FreshBooks' UI says entries can be edited and permanently deleted, subject to the user's role (contractors can edit only their own). [Time Entries API](https://www.freshbooks.com/api/time_entries), [FreshBooks time-entry management](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time)

The update examples send a broad record rather than a one-field patch, and the official SDK's request model requires `isLogged`, `startedAt`, and `duration`. A CLI update should therefore fetch, merge, and send preserved required fields rather than assume sparse `PUT` semantics. When a project changes, its `client_id` must move with it because projects are assigned to clients. [official SDK `TimeEntry` model](https://github.com/freshbooks/freshbooks-nodejs-sdk/blob/91cfeeeddda5c5d1dc7a7d66fd689aa4c3664f93/packages/api/src/models/TimeEntry.ts), [Projects API](https://www.freshbooks.com/api/project)

Whether billed entries reject some edits/deletion is not specified on the API page and must be surfaced as a server error rather than pre-guessed.

## Local dates, reporting weeks, and midnight

FreshBooks stores and filters `started_at` as UTC. An official response example also includes `local_started_at` and `local_timezone`. FreshBooks support says an individual's Time Entries use the time zone configured in that user's account; a business also exposes a `timezone` in FreshBooks' official SDK model. [Time Entries API](https://www.freshbooks.com/api/time_entries), [FreshBooks employee-entry example](https://www.freshbooks.com/api/how-to-add-time-entries-for-your-employees), [FreshBooks time-zone settings](https://support.freshbooks.com/hc/en-us/articles/360002789691-How-do-I-manage-my-basic-and-financial-information), [official SDK `Business` model](https://github.com/freshbooks/freshbooks-nodejs-sdk/blob/91cfeeeddda5c5d1dc7a7d66fd689aa4c3664f93/packages/api/src/models/Business.ts)

For this single-user plugin, each calendar day should be defined in the configured FreshBooks/user time zone, then its local midnight boundaries converted to UTC for `started_from`/`started_to`. Sunday-through-Saturday is the chosen Reporting Week; FreshBooks itself permits Sunday or Monday as the account's calendar start. Boundary conversion must be timezone-aware because daylight-saving transitions can make a local day 23 or 25 hours. [FreshBooks calendar settings](https://support.freshbooks.com/hc/en-us/articles/360002789691-How-do-I-manage-my-basic-and-financial-information)

The API filters by the entry's start timestamp, not by overlap with a duration interval. A calendar implementation should therefore assign a Time Entry to the local date containing its `started_at`, matching the available API query primitive. This is a **design inference**; the API wording does not separately define calendar attribution.

FreshBooks says a timer continues until paused, logged, or discarded, including after the browser closes. Neither the API nor support documentation says that a timer crossing local midnight is split. The resource shape can represent one start plus one duration, but that alone does not prove the web product's final behavior. Midnight handling is **unspecified** and must be observed live; the plugin must not invent a split before that test. [FreshBooks timer help](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time), [Time Entries API](https://www.freshbooks.com/api/time_entries)

## Required live-account characterization

These tests are prerequisites for an implementation-ready CLI timer contract. Capture full requests, responses, HTTP status, and the resulting web/mobile state using disposable test entries.

1. Start an unlogged timer with the minimum proposed payload; confirm defaults, returned timer ID, and visibility in web/mobile.
2. Attempt a second timer; determine whether FreshBooks permits it and preserve the plugin's stricter plural-detection behavior regardless.
3. Pause and resume in FreshBooks web; record the Time Entry representation before, during, and after, including duration evolution.
4. Reproduce those pause/resume transitions through public API requests identified from live observation; do not use undocumented fields in the released CLI until stable.
5. Correct duration while running and while paused; confirm continued accumulation, timer identity, and cross-client visibility.
6. Log running and paused timers; determine whether the API or caller computes duration and whether UI minute rounding applies.
7. Cross local midnight, including a daylight-saving boundary if practical; observe whether FreshBooks keeps one entry, which date owns it, and whether duration is altered.
8. Create entries without `billable` for hourly, flat-rate, internal, billable-service, and non-billable-service combinations; record returned values.
9. Race an API edit against a web edit and deletion; determine last-writer behavior and whether any reliable conflict response exists.
10. Exercise edits/deletion on billed and unbilled entries and record restrictions.

## Consequences for the next specification tickets

- Keep FreshBooks authoritative and poll on popup focus, after every command, and conservatively while visible.
- Treat active-timer discovery as a plural result and make “exactly one” an explicit plugin/CLI invariant.
- Implement Timer Switch as confirmed log followed by start; never start after an unconfirmed log.
- Do not ship local-only pause or Duration Correction.
- Preserve dirty local edits on refresh and require an explicit conflict choice.
- Omit billability UI initially, but adopt the server-returned value rather than deriving it from one project field.
- Use FreshBooks/user timezone boundaries and Sunday-through-Saturday grouping; do not split midnight-crossing work without validated native behavior.

## Research provenance

Only FreshBooks-owned documentation, FreshBooks' official Postman collection, and FreshBooks' official Node SDK source were used as evidence for FreshBooks behavior. The current `freshbooks-cli` implementation was inspected for compatibility but was not treated as authority over the remote API. No authenticated live FreshBooks account was available in this research session. The folder is not a Git repository, so the research-skill branch capture workflow was unavailable; this report was written directly into the shared tree.
