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

## Public Time Entry endpoint limitations

Creating a public Time Entry with `is_logged=false` produced an unlogged entry but no timer identity. The current CLI's assumption that this is a genuine running timer is false for the observed account.

A public Time Entry `PUT` carrying the existing timer identity and `is_running=true` was accepted but did not resume a paused web-created timer. A similar pause-shaped update on an API-created unlogged entry was accepted without producing a remotely paused state. FreshBooks therefore uses an additional, undocumented web timer operation for start, pause, and resume; the released CLI must not claim those capabilities until that operation is safely identified and validated.

Updating the duration of an API-created unlogged entry persisted the number but did not prove a Duration Correction on a genuine timer. For a genuine running timer, the web UI's correction changed the current segment's start anchor while preserving completed segment durations. A CLI correction should work against the grouped logical timer and adopt the server-reread aggregate.

## Other observed behavior

- FreshBooks accepted two API-created unlogged entries simultaneously. These entries had no timer identity and must not be confused with two logical timers.
- Replaying an update from a stale Time Entry snapshot was accepted; the last writer won and the response exposed no revision token. Compare-before-write remains a CLI responsibility.
- Omitting billability on the tested internal project returned a Boolean billable value. This one configuration does not establish a universal default across project and service types.
- Creating an unlogged entry with a start time across the UTC date boundary preserved one record and its supplied start. This does not establish real wall-clock web behavior across local midnight.

## Cleanup verification

The controlled scripts tracked every created entry and deleted it in `finally`. A bounded follow-up query found zero disposable marker entries and zero matching timers. The separate web-created characterization timer was logged for observation, then its single consolidated logged entry was deleted; a final query again found zero matching entries and timers.

## Remaining characterization blocker

Capture the FreshBooks web request method, path, and non-secret payload shape for starting, pausing, and resuming a genuine timer. Do not capture or publish cookies, authorization headers, CSRF values, live identifiers, or full HAR files. Validate the discovered operation with disposable data before adding it to `freshbooks-cli`.

## Primary references

- [FreshBooks Time Entries API](https://www.freshbooks.com/api/time_entries)
- [FreshBooks time-tracking help](https://support.freshbooks.com/hc/en-us/articles/225525527-How-do-I-track-my-time)
