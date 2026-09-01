---
id: SPEC-001
title: Build the Omarchy FreshBooks time-tracking plugin
status: open
labels:
  - ready-for-agent
assignee:
source_map: WF-001
---

# Build the Omarchy FreshBooks time-tracking plugin

## Problem Statement

Tracking work time in FreshBooks currently requires leaving the Omarchy desktop workflow for the FreshBooks website or another application. This makes starting, pausing, correcting, switching, and logging timers more disruptive than they need to be and makes it difficult to see recent work, daily totals, and weekly progress at a glance.

The desired experience is a native-feeling Omarchy 4 shell plugin that keeps FreshBooks authoritative while making the common time-tracking loop immediately accessible. It must be safe: switching projects must not lose the current timer, locally displayed changes must not diverge from FreshBooks, and remote edits from the web or another client must not be silently overwritten.

## Solution

Build a reusable, single-user-first Omarchy 4 Quickshell plugin backed exclusively by `freshbooks-cli`. The bar widget opens a keyboard-accessible panel with a Timer tab for the selected Active Timer and a Projects tab for quick switching. An expanded calendar/history mode shows Time Entries by FreshBooks-local day, daily totals, and Sunday-through-Saturday weekly totals, and supports adding, editing, and deleting entries.

FreshBooks remains the source of truth. The plugin refreshes when opened, after mutations, and periodically while visible; it stores only preferences, disposable cache, and recoverable drafts. Required additions to the user-owned CLI provide normalized, versioned JSON records, remotely confirmed timer mutations, safe multi-step Timer Switch behavior, conflict detection, bounded process behavior, and the client/project/history queries needed by the UI.

## User Stories

1. As an Omarchy user, I want to install the project as a normal shell plugin, so that I do not need to patch Omarchy itself.
2. As an Omarchy user, I want the FreshBooks widget to follow my current shell theme, so that it feels native to my desktop.
3. As an Omarchy user, I want the widget to work in horizontal and vertical bars, so that it fits my existing layout.
4. As an Omarchy user, I want the plugin to identify a missing or unsupported `freshbooks-cli`, so that setup failures are actionable.
5. As a FreshBooks user, I want authentication and credentials to remain owned by the CLI, so that the plugin does not create another credential store.
6. As a FreshBooks user, I want the plugin to use my CLI-selected FreshBooks business, so that it tracks time in the intended account.
7. As a FreshBooks user, I want clear guidance when the CLI is unauthenticated or no business is selected, so that I can finish setup in a terminal.
8. As a time tracker, I want to open a compact panel from the bar, so that routine timer work takes one interaction.
9. As a time tracker, I want the panel to show the selected Active Timer's project, client, note, state, and elapsed duration, so that I know what is being tracked.
10. As a time tracker, I want elapsed duration to tick smoothly between FreshBooks refreshes, so that the timer feels live.
11. As a time tracker, I want to start a timer for an active project, so that work is recorded in FreshBooks from the beginning.
12. As a time tracker, I want client names shown with projects, so that projects with similar names are distinguishable.
13. As a time tracker, I want to add or change notes while timing, so that the eventual Time Entry describes the work.
14. As a time tracker, I want to correct elapsed duration while a timer is running, so that interruptions or forgotten starts can be fixed immediately.
15. As a time tracker, I want a Duration Correction to update the running timer in FreshBooks, so that the browser, mobile app, and shell agree.
16. As a time tracker, I want a correction to commit deliberately on Enter or focus loss, so that every keystroke does not become a remote mutation.
17. As a time tracker, I want rejected corrections to restore the confirmed duration and explain the failure, so that the displayed timer never lies.
18. As a time tracker, I want to pause an Active Timer remotely, so that FreshBooks stops accumulating time everywhere.
19. As a time tracker, I want to resume a paused Active Timer remotely, so that the same work interval continues everywhere.
20. As a time tracker, I want pausing and logging to remain separate actions, so that I can review a paused timer before finalizing it.
21. As a time tracker, I want to explicitly log a timer, so that it becomes a completed Time Entry only when I am ready.
22. As a time tracker, I want to adjust duration and notes before logging, so that the finalized Time Entry is accurate.
23. As a time tracker, I want the current timer to survive closing the panel, reloading Quickshell, and restarting the machine, so that work is not lost.
24. As a time tracker, I want the plugin to reload the authoritative timer from FreshBooks after a restart, so that local clock drift or stale cache is discarded.
25. As a time tracker, I want a Projects tab with play/pause controls, so that switching work is quick.
26. As a time tracker, I want the selected Active Timer's project at the top of the Projects tab, so that its state is obvious.
27. As a time tracker, I want recently used projects near the top, so that my common work is easy to reach.
28. As a time tracker, I want recent-project ordering to reflect work logged in FreshBooks from any client, so that it is not limited to this plugin's history.
29. As a time tracker, I want to search active projects by project or client name, so that a large project list remains usable.
30. As a time tracker, I want archived and completed projects hidden by default, so that obsolete work does not clutter quick switching.
31. As a time tracker, I want a project shortcut to start immediately with blank notes, so that old notes are not submitted accidentally.
32. As a time tracker, I want starting another project to log the running or paused timer first, so that tracked work is preserved.
33. As a time tracker, I want a failed log to block the new timer from starting, so that two timers are not created after an unsafe switch.
34. As a time tracker, I want a switch to report when the old timer logged but the new timer failed to start, so that I understand the recoverable partial result.
35. As a time tracker, I want the plugin to detect multiple unlogged FreshBooks timers rather than silently choose one, so that exceptional remote state is recoverable.
36. As a time tracker, I want to choose which remote timer to recover when multiple candidates exist, so that the plugin can restore its single-Active-Timer workflow safely.
37. As a time reviewer, I want to expand the panel into a calendar/history view, so that I can inspect work without opening FreshBooks.
38. As a time reviewer, I want the calendar to use Sunday-through-Saturday weeks, so that it matches my FreshBooks workflow.
39. As a time reviewer, I want each day to indicate whether entries exist, so that recorded work is visible at a glance.
40. As a time reviewer, I want each day cell to show its logged total, so that daily effort is visible without opening the day.
41. As a time reviewer, I want the selected week's logged total, so that I can track weekly progress.
42. As a time reviewer, I want the running timer shown separately from logged totals, so that unsubmitted work is never mistaken for a Time Entry.
43. As a time reviewer, I want to select a calendar day, so that I can see its Time Entries.
44. As a time reviewer, I want a day's entries in chronological order, so that I can understand how the day was spent.
45. As a time reviewer, I want to add a Time Entry from the selected day, so that missed work is easy to record.
46. As a time reviewer, I want to edit an entry's project, client, date, duration, and notes, so that mistakes can be corrected.
47. As a time reviewer, I want changing an entry's project to update its client consistently, so that invalid project/client combinations are not created.
48. As a time reviewer, I want to delete a Time Entry only after confirmation, so that destructive mistakes are difficult.
49. As a time reviewer, I want affected daily and weekly totals to refresh immediately after a mutation, so that summaries remain trustworthy.
50. As a FreshBooks user, I want billability omitted from the first UI and derived according to the project's FreshBooks rules, so that I do not have to manage it twice.
51. As a FreshBooks user, I want calendar dates to follow my FreshBooks/user timezone, so that entries appear on the same day in both interfaces.
52. As a FreshBooks user, I want timers crossing midnight to follow verified FreshBooks behavior, so that the plugin does not invent incompatible splitting.
53. As a multi-client user, I want remote timer and entry changes adopted automatically when I have no local edit, so that all FreshBooks clients remain in sync.
54. As a multi-client user, I want unfinished local input preserved when a remote change arrives, so that refresh does not erase my work.
55. As a multi-client user, I want a Changed in FreshBooks warning with Reload and Apply Mine choices, so that conflicting edits are explicit.
56. As a time tracker, I want the plugin to refresh on panel open, after each operation, and periodically while visible, so that remote state stays current without constant background traffic.
57. As a time tracker, I want ambiguous network failures reconciled from FreshBooks before retry, so that duplicate or overwritten entries are avoided.
58. As a time tracker, I want successful operations to remain visually quiet, so that the panel does not become noisy.
59. As a time tracker, I want failures to remain visible with an actionable next step, so that lost or uncertain time cannot be overlooked.
60. As a keyboard user, I want to navigate tabs, projects, timer actions, calendar days, entries, editors, and dialogs without a mouse, so that the full workflow is accessible.
61. As a keyboard user, I want text fields and dropdowns to receive normal editing keys without triggering panel shortcuts, so that data entry is predictable.
62. As a keyboard user, I want deletion to require confirmation even when invoked by shortcut, so that speed does not weaken safety.
63. As a multi-monitor user, I want every bar widget to share one FreshBooks state and mutation queue, so that monitors cannot disagree or start competing operations.
64. As a multi-monitor user, I want visible polling to continue while any plugin panel is open, so that closing one monitor's panel does not stop another's refresh.
65. As a user on a narrow display, I want the expanded calendar to fit or scroll without clipping controls, so that the feature remains usable.
66. As a maintainer, I want the plugin to expose bounded diagnostic status without credentials or note history, so that failures can be investigated safely.
67. As a maintainer, I want compatibility failures against a newer Omarchy 4 release to be isolated, so that source-level shell dependencies can be adapted in one place.

## Implementation Decisions

- Package the repository itself as a root-manifest Omarchy plugin with both `service` and `bar-widget` kinds. Publish from a stable default branch, use semantic releases, keep the manifest version synchronized, validate before release, and document the tested Omarchy 4 and CLI versions because the manifest cannot express compatibility constraints.
- Use Omarchy's current source-level UI and theme modules for native appearance and interaction. Isolate those imports and service lookup conventions behind a thin compatibility module because they are first-party conventions rather than a versioned public extension interface.
- Build one deep singleton time-tracking module as the primary seam. Its interface exposes authoritative snapshots and high-level intents such as refresh, start, pause, resume, correct, log, switch, create/update/delete entry, conflict resolution, and visible-consumer registration. It hides process lifecycle, queuing, reconciliation, caching, and elapsed-time anchoring from every view.
- Put a CLI adapter behind the singleton module. Production uses the real `freshbooks-cli`; tests use a fake adapter at the same seam. Do not introduce direct FreshBooks HTTP calls or a second remote adapter.
- Invoke the CLI as an argument array without a shell. Require one bounded JSON document, separate stdout from stderr, distinguish nonzero exit, signal, timeout, invalid JSON, schema mismatch, and declared CLI errors, and never interpolate notes or names into shell command text.
- Serialize all mutations through one queue. Reads may be coalesced, but overlapping refreshes must not produce competing state adoption and mutations must not race each other.
- Treat FreshBooks as authoritative for the Active Timer and Time Entries. The plugin may cache confirmed snapshots for fast paint, but it must mark them stale and replace them after the first successful refresh.
- Define Active Timer as the single unlogged timer selected by the plugin, not as a FreshBooks global invariant. Timer discovery returns a collection; zero, one, and multiple candidate states are handled explicitly.
- Do not ship local-only pause, resume, or Duration Correction. Before implementation, characterize the authenticated FreshBooks behavior for pause/resume, running and paused duration replacement, repeated operations, cross-client visibility, stale writes, logging/rounding, billability defaults, and midnight crossing. Capture full requests, responses, status codes, and resulting web state using disposable entries.
- Release a plugin-compatible CLI contract before the plugin depends on it. The audited CLI version is only a baseline; the compatible release must expose its version in JSON and protect normalized inner schemas with SemVer or an explicit schema version.
- Add normalized CLI records for Client, Project, Time Entry, and Active Timer with declared required and nullable fields, one naming convention, and authoritative post-mutation records. Do not leak raw FreshBooks response shapes into QML.
- Add normalized client discovery and project records joined to client display names. Preserve the distinction between FreshBooks business identity and accounting account identity inside the CLI.
- Add bounded recent-project/history queries and explicit FreshBooks-local date-range semantics. Ranking comes from FreshBooks Time Entry history; local cache exists only to make the initial render fast.
- Add a single-entry read operation and fetch-merge-update behavior for Time Entries so required FreshBooks fields survive replacements and remote changes can be detected before writing.
- Add verified CLI operations for pause, resume, and timer-specific note/Duration Correction. Each returns the confirmed normalized Active Timer; a running correction only rebases local ticking after FreshBooks confirms the replacement duration.
- Add a high-level CLI Timer Switch operation. It confirms logging the selected running or paused timer before starting the next Project Shortcut. Log failure must prevent start. Log success followed by start failure must return an explicit partial result containing the logged Time Entry.
- Add compare-before-write snapshot tokens to timer and entry reads and accept them on mutations. If relevant remote state changed, return a stable remote-change error and the authoritative record for the Reload/Apply Mine flow. This is a CLI-owned guard because FreshBooks does not document ETags or compare-and-swap semantics.
- Add bounded CLI network behavior with a stable timeout error and no interactive prompts in JSON mode. After a killed, timed-out, or otherwise ambiguous mutation, the plugin marks the outcome unknown and refreshes before enabling retry.
- Keep authentication and credentials entirely under CLI ownership. Startup diagnostics inspect only JSON status, CLI version, selected business, and declared capabilities; setup directs the user to terminal commands.
- Use one clock-shaped `KeyboardPanel` associated with the bar widget. It has compact Timer and Projects modes and expands in place to Calendar/Day Entries mode, preserving draft and selection context while participating in Omarchy's normal panel switching and dismissal behavior.
- Instantiate bar views per monitor but resolve all of them to the singleton module. Track visible consumers by widget/screen identity; poll while at least one panel remains visible.
- Refresh at logical panel open, after every CLI completion, and approximately every 15 seconds while visible. Display elapsed time may tick locally between refreshes, but every refresh rebases it from FreshBooks and closed panels do not poll continuously.
- Keep the confirmed server snapshot separate from editable drafts. A refresh with no dirty field adopts remote state automatically. A refresh touching a dirty field preserves local input, suspends automatic save, and presents Reload or Apply Mine.
- Commit a Duration Correction on Enter or focus loss, show a saving state, and adopt only the FreshBooks-confirmed response. On rejection, restore the confirmed value and retain an actionable error.
- The Timer tab supports start, pause/resume, explicit log, project/client display, notes, and editable duration. Pausing does not implicitly log. Successful completion is subtle; errors persist until resolved or dismissed.
- The Projects tab puts the selected project first, then FreshBooks-derived recency order, and searches active projects by project and client name. Archived/completed projects are hidden by default. Starting a shortcut uses blank notes and invokes the safe Timer Switch when another running or paused timer exists.
- Multiple unlogged timers trigger a recovery state instead of automatic selection. The user chooses the candidate to manage; no mutation proceeds against an ambiguous timer set.
- The expanded calendar follows the first-party clock's panel, theme, spacing, narrow-screen, focus, and navigation conventions while making days selectable. It always renders Sunday first and distinguishes keyboard cursor, selected day, today, and days with entries.
- Calendar cells show an entry indicator and logged daily total. The selected week shows a Sunday-through-Saturday logged total. The Active Timer remains visually separate and is not included until logged.
- Selecting a day opens its entries in chronological order with Add Entry. Entry editing supports project/client, FreshBooks-local date, duration, and notes; project changes carry the associated client. Saving is explicit, deletion is confirmed, and affected aggregates refresh after success.
- Omit billability controls and breakdowns initially. The CLI must validate whether omission applies FreshBooks project/service rules and, if necessary, derive the correct value; the plugin adopts the billability returned by FreshBooks.
- Define calendar days in the configured FreshBooks/user timezone and convert their local boundaries to UTC with daylight-saving awareness. Attribute an entry to the local date containing its start timestamp, matching the available FreshBooks filtering model. Do not split a timer at midnight unless live characterization proves FreshBooks does so.
- Store small user preferences in Omarchy shell configuration, versioned recoverable drafts in Quickshell state storage, and disposable confirmed snapshots/recent ordering in Quickshell cache storage. Never write runtime data into the installed plugin checkout and never reconstruct an Active Timer solely from local storage.
- On startup, hot reload, or shell restart, optionally paint stale cache, immediately query FreshBooks, and replace timer state from the result. Corrupt or incompatible cache is discarded; draft migration must be versioned and failure must preserve the original file for diagnosis.
- Use one logical keyboard cursor shared with mouse hover. Support arrows and `hjkl`, Enter/Space activation, left/right tab switching, Escape dismissal, and safe delete shortcuts. Disable panel-level shortcuts while an editor, dropdown, or confirmation dialog owns focus.
- Provide a small diagnostic/launch interface for open, close, toggle, open-calendar, refresh, and bounded status. Status may include readiness, selected business, CLI compatibility, timer summary, and last error, but never credentials or full note history.

## Testing Decisions

- Test externally observable behavior rather than QML object structure, private properties, CLI helper functions, or process-call counts. A good test supplies an authoritative CLI scenario, sends user-level intent through the singleton time-tracking module's interface, and asserts the resulting public snapshot, enabled actions, durable draft state, emitted diagnostic, or CLI-visible result.
- Use the singleton time-tracking module's interface as the primary test seam. Run deterministic behavior tests with a fake CLI adapter covering zero/one/multiple timers, running/paused/logged state, elapsed rebasing, correction confirmation/rejection, safe switch phases, refresh coalescing, stale reads, dirty-field conflicts, timeout ambiguity, restart hydration, and visible-consumer polling.
- Contract-test the real CLI adapter with a controllable fake executable. Cover success/error envelopes, schema versions, stderr/stdout separation, exit classes, malformed or oversized responses, timeouts, signals, partial Timer Switch results, remote-change records, and argument safety for notes and names.
- In the `freshbooks-cli` project, add high-level command/service tests for normalized clients/projects/entries/timers; verified pause/resume/correction; safe Timer Switch ordering and partial failure; snapshot-token comparisons; local-date ranges; billability behavior; network timeout; and stable JSON/error contracts. Follow its existing command-output and FreshBooks service test style.
- Add pure transformation tests only where they provide extra leverage behind the primary module: six-row calendar generation, Sunday–Saturday ranges, daylight-saving boundaries, daily/weekly aggregation, recency ordering, and elapsed-time anchoring. Do not expose these helpers merely to test them.
- Validate the plugin manifest in CI and run a Quickshell/Omarchy runtime smoke test for plugin discovery, singleton creation, per-monitor widget lookup, popup open/close, expanded mode, focus restoration, IPC, theme changes, and hot reload. Follow the first-party clock model tests and shell runtime smoke tests as prior art.
- Exercise a small number of highest-value view tests through keyboard and pointer input: start/pause/resume/log, project search and safe switch, conflict choice, calendar selection, entry create/edit/delete, confirmation, persistent error, and narrow-screen scrolling. Assert visible state and actions, not internal QML hierarchy.
- Run authenticated characterization tests against disposable FreshBooks entries before releasing timer mutations. These tests are evidence-gathering gates, not routine destructive CI; record resulting FreshBooks web state and clean up fixtures explicitly.
- Manually validate on the supported Omarchy 4 release with horizontal and vertical bars, multiple monitors, a narrow screen, keyboard-only navigation, theme changes, shell restart during a remote timer, remote web edits, offline recovery, multiple timers, and timers crossing the local day boundary.
- Release acceptance requires CLI and plugin compatibility checks, manifest validation, all automated tests, successful manual timer characterization, and confirmation that the FreshBooks browser reflects pause/resume/correction/switch results.

## Out of Scope

- Invoicing, expenses, estimates, payments, and other FreshBooks workflows unrelated to time tracking.
- General-purpose reporting, export, charts, and profitability analysis beyond calendar entry indicators and daily/weekly duration totals.
- Multi-account or multi-business switching inside the plugin; it uses the business selected by `freshbooks-cli`.
- Manual billability controls or billable/non-billable summary breakdowns in the initial release.
- Frequency scoring, pinned projects, and archived-project browsing in the initial Projects tab; recency is the ordering rule after the selected project.
- Non-FreshBooks backends and direct FreshBooks HTTP access from the plugin.
- Bundling, installing, authenticating, or managing credentials for `freshbooks-cli` from the plugin.
- A general public IPC automation interface beyond the small launch, refresh, and diagnostic surface required for shell integration.
- Background polling while every plugin panel is closed.
- Inventing local pause, timer splitting, or Duration Correction behavior when FreshBooks has not confirmed the remote operation.

## Further Notes

- The current folder contains planning and research artifacts but no plugin implementation or initialized Git repository.
- The public FreshBooks contract models timers as unlogged Time Entries and does not guarantee only one timer. The single Active Timer is a plugin workflow rule, not a remote invariant.
- FreshBooks publicly documents logging a timer but not the request protocol for pause/resume, continuing after a Duration Correction, stale-write handling, or midnight behavior. Live-account characterization is a hard prerequisite for those CLI contracts.
- `freshbooks-cli` version 0.1.0 is a viable exclusive integration baseline but is not the plugin-compatible minimum. A subsequent release must supply the normalized and verified contracts described above.
- Omarchy 4 supports a root-manifest service plus bar-widget shape. The recommended UI follows the built-in clock's panel and calendar grammar, while treating its internal UI/theme imports as source-level compatibility dependencies.
- Supporting research is recorded under the titles “FreshBooks timer semantics,” “freshbooks-cli time-tracking surface audit,” and “Omarchy 4 Quickshell extension seams.”
