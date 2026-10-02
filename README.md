# FreshBooks Time for Omarchy

An Omarchy 4 / Quickshell bar plugin for managing FreshBooks timers and reviewing logged work without leaving the desktop.

The popup provides:

- a live Timer tab with notes, explicit duration correction, pause/resume, and log
- a Projects tab ordered by the active and most recently used project/service combinations, with one-click safe switching
- a Sunday–Saturday calendar with daily and weekly logged totals and day-entry lists showing project, service, and notes; **Play** starts fresh time from an entry or resumes a matching paused timer, and **Stop** pauses a running timer with the same project, service, and notes
- guided OAuth and business selection when FreshBooks has not been configured yet

Accepted edits update the panel immediately and close an open entry editor while the write settles. Before the CLI is started, the operation's typed draft and optimistic projection are saved atomically in Quickshell's state directory. A valid CLI mutation receipt is the fast path: it confirms the canonical result without a follow-up read.

If a write times out or otherwise has an unknown outcome, the plugin never retries it automatically. It keeps the affected record locked, preserves the draft and projection across restart, and performs a deletion-aware reconciliation read; unrelated records remain usable. When FreshBooks changed the same record, conflicts are shown by semantic field group—note, duration, date, assignment, or timer state—so each group can use **Mine** or **FreshBooks**. If FreshBooks deleted a locally edited record, choose **Restore as new** to create a fresh record without reusing the deleted identity, or **Discard local** to accept the deletion.

FreshBooks remains authoritative. The plugin refreshes when opened, after mutations that still require reconciliation, and every 15 seconds while visible. Starting another project logs the current timer first; a failed log prevents the new timer from starting.

## Requirements

- Omarchy 4 with the root-manifest shell plugin system
- Node.js 22 or newer
- `freshbooks-cli` 0.3.0 or newer, authenticated and available as `freshbooks` on Quickshell's `PATH`; the CLI must advertise canonical tracking contract 2

## Install

After installing `freshbooks-cli`:

```bash
omarchy plugin add https://github.com/kmorey/quickshell-freshbooks --enable
```

Add the **FreshBooks Time** widget to the bar through Omarchy's bar settings. Click the bar timer to open the panel. If FreshBooks is not configured, the popup walks through OAuth application credentials, browser authorization, and business selection without requiring a separate terminal.

Authentication and OAuth credentials remain owned by `freshbooks-cli`. Setup secrets and authorization callbacks are sent to the CLI over stdin and cleared from popup fields immediately; this plugin never reads the keyring, stores OAuth or access tokens, or writes runtime data into its installed checkout.

Accepted but unsettled operations are stored in `kmorey.freshbooks-operation-ledger.json` under Quickshell's per-shell state directory so drafts can recover after a crash or restart. The file contains only typed operation data needed for recovery, including canonical semantic guard tokens; it excludes OAuth and access tokens, client secrets, authorization headers, request stdin, raw responses, and transport diagnostics. Settled operations are compacted after durable acknowledgement.

## Development

```bash
npm test
omarchy plugin validate .
```

The final development gate is an opt-in real-QML smoke. Run it only from an
Omarchy graphical session and isolate Quickshell's persisted state:

```bash
state_root=$(mktemp -d)
cache_root=$(mktemp -d)
SMOOTH_SETTLEMENT_SMOKE=1 \
  XDG_STATE_HOME="$state_root" \
  XDG_CACHE_HOME="$cache_root" \
  quickshell -p test/SmokeHarness.qml
```

The harness is never selected by production startup and refuses to run without
`SMOOTH_SETTLEMENT_SMOKE=1`. It uses the production `Service`, `ServiceRuntime`,
`Panel`, and `LedgerStore` with synthetic responses from `FakeCliAdapter`.
Follow the visible `SMOKE-1` through `SMOKE-7` rows in order. Use the actual
Panel conflict controls: pointer-select **Mine** for note, keyboard-select
**FreshBooks** for duration, pointer-select **Restore as new**, and
keyboard-select **Discard local**. Capture readable screenshots plus a short
interaction recording, including the isolated state/cache roots and tested
revision in private validation metadata. Any red row exits nonzero; the gate is
not replaceable by the Node suite, source scans, or mocked rendering.

The panel uses Omarchy's shared buttons, cursor surfaces, section headings, hero layout, and theme tokens so interaction states follow the rest of the shell. The Node suite covers calendar/date behavior, timer projections, duration parsing, project/service recency, canonical contract validation, durable operation recovery, request coordination, the fake CLI seam, the production Service runtime, and packaging contracts. CI also executes the real `freshbooks-cli` diagnostics command and requires CLI 0.3.0 with canonical contract 2 before validating the plugin manifest. A complete release also requires an Omarchy/Quickshell runtime smoke test because Node cannot instantiate QML; keyboard/pointer interaction and horizontal, vertical, narrow, and multi-monitor layouts remain part of that manual gate.

## Privacy

Diagnostic state is intentionally bounded. Do not add OAuth tokens, request headers, FreshBooks API responses, client data, project membership data, or real time-entry notes to fixtures, logs, screenshots, issues, or commits.
