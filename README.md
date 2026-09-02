# FreshBooks Time for Omarchy

An Omarchy 4 / Quickshell bar plugin for managing FreshBooks timers and reviewing logged work without leaving the desktop.

The popup provides:

- a live Timer tab with notes, explicit duration correction, pause/resume, and log
- a Projects tab ordered by the active and most recently used projects, with one-click safe switching
- a Sunday–Saturday calendar with daily and weekly logged totals and day-entry lists

Timer and entry drafts are compared against FreshBooks snapshot tokens. If the browser or another client changes a dirty record, the panel offers **Reload** or **Apply mine** instead of silently overwriting it. Timed-out mutations are reconciled with a refresh before retry is enabled.

FreshBooks remains authoritative. The plugin refreshes when opened, after mutations, and every 15 seconds while visible. Starting another project logs the current timer first; a failed log prevents the new timer from starting.

## Requirements

- Omarchy 4 with the root-manifest shell plugin system
- Node.js 22 or newer
- `freshbooks-cli` 0.2.0 or newer, authenticated and available as `freshbooks` on Quickshell's `PATH`

During development, the required CLI contract is tracked in [freshbooks-cli PR #1](https://github.com/kmorey/freshbooks-cli/pull/1).

## Install

After installing and authenticating `freshbooks-cli` in a terminal:

```bash
omarchy plugin add https://github.com/kmorey/quickshell-freshbooks --enable
```

Add the **FreshBooks Time** widget to the bar through Omarchy's bar settings. Click the bar timer to open the panel.

Authentication and OAuth credentials remain owned by `freshbooks-cli`. This plugin never reads the keyring, stores tokens, or writes runtime data into its installed checkout. Unsubmitted editor drafts are atomically stored in Quickshell's per-shell state directory and removed after a confirmed save.

## Development

```bash
npm test
omarchy plugin validate .
```

The Node test suite covers calendar/date behavior, timer projections, duration parsing, recent-project ordering, the fake CLI seam, and packaging contracts. A complete release also requires an Omarchy/Quickshell runtime smoke test because Node cannot instantiate QML; keyboard/pointer interaction and horizontal, vertical, narrow, and multi-monitor layouts remain part of that manual gate.

## Privacy

Diagnostic state is intentionally bounded. Do not add OAuth tokens, request headers, FreshBooks API responses, client data, project membership data, or real time-entry notes to fixtures, logs, screenshots, issues, or commits.
