# FreshBooks live timer characterization

Characterized on 2026-09-02 with one authorized internal project and disposable generic notes. All created records were deleted after observation. This report intentionally excludes business, identity, client, project, service, entry, and timer identifiers.

## Confirmed logical model

FreshBooks represents one logical timer with a timer identity shared by one or more unlogged Time Entry segments. The public list endpoint can therefore return multiple unlogged records without representing multiple logical timers. Timer discovery must group records by timer identity before deciding whether the account has zero, one, or multiple Active Timers.

The observed duration-format lifecycle was:

1. Starting in the FreshBooks web UI created one unlogged segment with a timer identity, `timer.is_running=true`, and no stored duration.
2. Pausing stored the observed 57-second duration on that segment and set `timer.is_running=false`.
3. Resuming in the web UI created a second unlogged segment with the same timer identity. The first retained its 57-second duration and the new running segment had no stored duration.
4. While running, changing the displayed total to `10:00`—ten hours in FreshBooks' duration input—preserved the completed 57-second segment and moved the running segment's start time backward to make the aggregate match the correction.
5. Pausing produced stored segment durations of 36,047 and 57 seconds, totaling the displayed `10:01:44`.
6. Logging consolidated both segments into one logged Time Entry of 36,120 seconds (`10:02`), applying FreshBooks' documented nearest-minute timer rounding.

The running display uses `HH:MM:SS`. FreshBooks' duration editor uses `HH:MM` and permits optional seconds, so plugin parsing and presentation must keep these interfaces distinct.

## Start request shape

The FreshBooks web UI starts a timer in two Time Entry requests:

1. `POST /comments/business/<ID>/time_entries` creates a blank unlogged entry. Its `time_entry` payload includes `duration: null`, `started_at`, `local_timezone`, and—critically—`timer: {}`. It initially has no project, service, client, note, or identity selection.
2. `PUT /comments/business/<ID>/time_entries/<ID>` updates that entry with the timer identity returned by the first request plus the authenticated identity, selected project and service, note, local start timestamp, and project-derived flags.

Creating a public Time Entry with `is_logged=false` but without `timer: {}` produced an unlogged entry with no timer identity. The current CLI's assumption that any unlogged entry is a genuine running timer is therefore false for the observed account. A genuine start must request timer creation explicitly, retain the authoritative response, and complete the assignment update before reporting success.

## Pause request shape

The FreshBooks web UI pauses a running timer with one `PUT /comments/business/<ID>/time_entries/<ID>` against the open Timer Segment. The payload retains the segment's timer identity, authenticated identity, project, service, note, flags, start timestamps, and timezone, and replaces `duration: null` with the elapsed whole-second duration. It does not send an explicit `is_running` field. A segment with a fixed duration is closed; the logical timer is paused when it has no open segment.

## Resume request shape

The FreshBooks web UI resumes a paused timer with one `POST /comments/business/<ID>/time_entries`. It creates a new open Timer Segment with `duration: null`, the current UTC start timestamp, the existing timer identity in `timer.id`, and the prior note, project, service, timezone, and flags. The observed request left `identity_id` and `local_started_at` null rather than copying them from the closed segment. The prior segment remains closed with its stored duration. Resume therefore appends to the logical timer; it does not reopen or mutate an earlier segment.

## Running Duration Correction request shape

Correcting the running timer caused one `PUT /comments/business/<ID>/time_entries/<ID>` per Timer Segment. Each payload carried the shared timer identity and normalized common metadata. Closed segments retained their fixed durations and start timestamps. The open segment retained `duration: null`, but FreshBooks rebased its UTC and local start timestamps so that completed segment durations plus the open segment's elapsed time matched the requested aggregate total.

Immediately after this correction the web UI displayed `01:00:01` and continued ticking by seconds. This confirms that the editor changes the logical timer's aggregate elapsed duration rather than the open segment alone. The observed text entry was interpreted as a one-hour target; the plugin should use an explicit parser and preview rather than depend on ambiguous browser-field formatting.

## Public Time Entry endpoint limitations

A public Time Entry `PUT` carrying the existing timer identity and `is_running=true` was accepted but did not resume a paused web-created timer. An earlier update on an API-created unlogged entry without a genuine timer identity could not produce a remotely paused state. The genuine pause request closes the open Timer Segment with a concrete duration, while resume POSTs a new open segment carrying the existing timer identity.

Updating the duration of an API-created unlogged entry persisted the number but did not prove a Duration Correction on a genuine timer. For a genuine running timer, the web UI's correction changed the current segment's start anchor while preserving completed segment durations. A CLI correction should work against the grouped logical timer and adopt the server-reread aggregate.

## Other observed behavior

- FreshBooks accepted two API-created unlogged entries simultaneously. These entries had no timer identity and must not be confused with two logical timers.
- Replaying an update from a stale Time Entry snapshot was accepted; the last writer won and the response exposed no revision token. Compare-before-write remains a CLI responsibility.
- Omitting billability on the tested internal project returned a Boolean billable value. This one configuration does not establish a universal default across project and service types.
- Creating an unlogged entry with a start time across the UTC date boundary preserved one record and its supplied start. This does not establish real wall-clock web behavior across local midnight.

## Cleanup verification

The controlled scripts tracked every created entry and deleted it in `finally`. A bounded follow-up query found zero disposable marker entries and zero matching timers. The separate web-created characterization timer was logged for observation, then its single consolidated logged entry was deleted; a final query again found zero matching entries and timers.

## Remaining characterization work

Capture the FreshBooks web request method, path, and non-secret payload changes for final logging. Do not retain or publish cookies, authorization headers, CSRF values, live identifiers, or full HAR files. Then validate the observed start, pause, resume, correction, and log operations with disposable data before adding them to `freshbooks-cli`.

## Primary references

- [FreshBooks Time Entries API](https://www.freshbooks.com/api/time_entries)
- [FreshBooks time-tracking help](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time)
