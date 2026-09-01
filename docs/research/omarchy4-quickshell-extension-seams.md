# Omarchy 4 Quickshell extension seams

Research date: 2026-09-01

## Executive answer

The FreshBooks integration should be a normal Omarchy shell plugin repository, not a separate Quickshell configuration or daemon. Its root `manifest.json` should declare a namespaced third-party id and two kinds: `service` for one long-lived FreshBooks state/process coordinator, and `bar-widget` for the timer label and its popup. `allowMultiple` should be false. The bar widget should follow the built-in clock's shape: extend Omarchy's `BarWidget`, keep a nested `Panel`/`KeyboardPanel` loaded, and switch that one popup between the compact Timer/Projects modes and the expanded calendar/history mode. Omarchy runs all of these components inside one long-lived `omarchy-shell` process and supports multi-kind manifests. [Omarchy shell architecture and manifest contract](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/README.md#L1-L92), [built-in Media service/widget manifest](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/services/media/manifest.json)

The service must own all `freshbooks-cli` processes, remote snapshots, refresh scheduling, mutation serialization, and dirty-edit conflict state. This avoids one CLI coordinator per monitor: Omarchy creates a bar surface and widget instance for each monitor, while its service loader creates one service object per enabled plugin id. [bar-widget multi-monitor contract](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Ui/BarWidget.qml#L25-L35), [generic service loader](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/shell.qml#L263-L359)

Use `Quickshell.Io.Process` with argument arrays, `StdioCollector`, exit codes, and JSON stdout for all observed commands. Do not use detached processes for FreshBooks mutations: Quickshell cannot report their completion, and ordinary child processes are terminated when Quickshell exits or reloads. A Timer Switch should therefore be one CLI-level operation (or at minimum one service-owned serial workflow), followed by a FreshBooks refresh after success, error, timeout, or shell restart. [Quickshell `Process`](https://quickshell.org/docs/v0.3.0/types/Quickshell.Io/Process/), [Omarchy's CLI-backed service pattern](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/tailscale/Service.qml#L389-L487)

The manifest/installation/IPC contract is documented. The attractive native QML kit under `qs.Ui` and `qs.Commons` is not documented as a stable third-party API; using `BarWidget`, `Panel`, `KeyboardPanel`, `PanelKeyCatcher`, `Style`, and `Color` is a source-derived Omarchy 4 convention. It is the right trade-off for a native-feeling plugin, but it creates an explicit Omarchy compatibility boundary that must be isolated and tested.

## Research baseline and evidence labels

The latest stable release inspected was [Omarchy v4.0.2](https://github.com/omacom/omarchy/releases/tag/v4.0.2), published 2026-08-31. The current `quattro` branch was also inspected at [`b71dcad96e9d0b2962b7d225828a5cb6000ad720`](https://github.com/omacom/omarchy/commit/b71dcad96e9d0b2962b7d225828a5cb6000ad720). The plugin loader, manifest rules, popup primitives, and service loader are the same at both points; the relevant post-release clock change only adds optional seconds formats.

This report uses two evidence labels:

- **Documented API**: stated by the official Omarchy manual/shell documentation or Quickshell type documentation.
- **Source convention**: behavior visible in first-party Omarchy 4 source, but not promised as a stable extension API.

## Installable plugin contract

### Documented API

An installable plugin is a git repository with `manifest.json` at its root. Omarchy clones it to `~/.config/omarchy/plugins/<id>/`, validates it, and enables it through shell configuration/IPC. The third-party id must be namespaced and cannot start with the reserved `omarchy.` namespace. `schemaVersion` must be the JSON number `1`; `id`, `name`, `version`, a non-empty `kinds` array, and `entryPoints` are required. Each declared known kind must have its corresponding safe relative entry point, the referenced file must exist, and no symlink may appear anywhere in the plugin directory. [official Shell Plugins manual](https://omarchy.org/manual/shell-plugins/), [manifest validator](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/bin/omarchy-plugin-validate)

Recommended initial manifest shape:

```json
{
  "schemaVersion": 1,
  "id": "kmorey.freshbooks-time",
  "name": "FreshBooks Time",
  "version": "0.1.0",
  "author": "Kevin Morey",
  "description": "FreshBooks timer, project shortcuts, and calendar review",
  "kinds": ["service", "bar-widget"],
  "entryPoints": {
    "service": "Service.qml",
    "barWidget": "BarWidget.qml"
  },
  "barWidget": {
    "displayName": "FreshBooks Time",
    "category": "Time",
    "allowMultiple": false,
    "defaultSection": "center"
  }
}
```

The id is a proposed namespace, not an Omarchy requirement beyond the general id rules. `defaultSection` can be changed later without changing the architecture.

`omarchy plugin add <git-url> --enable` is the user-facing installation path; `omarchy plugin validate .` should be the packaging/CI gate. The installer deliberately runs no plugin code, install hook, or `sudo`, so `freshbooks-cli` remains a separately installed and authenticated prerequisite. The plugin may diagnose a missing executable or incompatible CLI version but cannot depend on an installation script being invoked. [installation behavior](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/README.md#L94-L141), [plugin add implementation](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/bin/omarchy-plugin-add)

Enabling a third-party bar widget puts its id in `bar.layout.<section>` in `~/.config/omarchy/shell.json`; this same presence enables every kind in the multi-kind plugin, including its service. Widget settings are fields inline on that layout entry rather than a nested config object. [shell state rules](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/README.md#L213-L281), [registry enable rules](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/services/PluginRegistry.qml#L100-L152)

### Version and update consequences

Omarchy requires the manifest's `version` field but does not validate its format, compare it during update, or provide a minimum-Omarchy/minimum-Quickshell manifest field. Updates fetch the installed checkout's remote `HEAD`, require a fast-forward, show a diff interactively, revalidate afterward, and roll back a validation failure. [plugin update implementation](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/bin/omarchy-plugin-update), [registry validation](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/services/PluginRegistry.qml#L30-L89)

Therefore:

- keep a stable default branch because that is what ordinary installs and updates follow;
- use semantic release tags and keep the manifest version synchronized, even though Omarchy does not enforce either;
- state the tested Omarchy 4 and `freshbooks-cli` versions in the README and release notes;
- isolate all imports/usages of Omarchy's source-level UI kit so 4.x changes are easy to adapt;
- avoid submodules, generated dependencies, and symlinks; the ordinary clone is the complete installed payload;
- never write cache or draft data into the installed checkout, because local changes can prevent a future fast-forward update.

## Recommended runtime boundary

### One service, many views

**Documented API:** `service` is the headless plugin kind, and a manifest can declare multiple kinds. [manifest kinds](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/README.md#L46-L90)

**Source convention:** the shell creates exactly one object for each enabled service id and exposes it through `shell.serviceFor(id)`. The first-party Media plugin combines `service` and `bar-widget`; each bar widget resolves the shared service through the bar's shell object. [service creation and lookup](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/shell.qml#L263-L359), [Media bar-widget lookup](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/services/media/BarWidget.qml#L1-L17)

`Service.qml` should therefore own:

- the last authoritative Active Timer snapshot and elapsed-time anchor;
- client/project and time-entry snapshots;
- daily and Sunday-through-Saturday totals derived from FreshBooks-returned data;
- the mutation queue and all `Process` objects;
- refresh de-duplication, visible-consumer tracking, and backoff;
- dirty draft/conflict metadata shared by the compact and expanded views;
- actionable diagnostics for missing CLI, authentication, unsupported CLI version, parse failures, timeouts, and FreshBooks errors.

Bar widgets are instantiated per monitor. A single Boolean such as `panelVisible` in the service would race when a panel closes on one monitor while another remains open. Track visible consumers as a set keyed by widget/screen instance, and poll while that set is non-empty. This is an inference from the multi-monitor widget contract, not a supplied Omarchy helper.

### Popup and expanded calendar

The built-in clock is a `bar-widget` whose `BarWidget.qml` permanently loads a sibling `Panel.qml`, injects the bar/settings/anchor, and exposes `open`, `close`, `opened`, and the popout-switch handshake on the widget root. Its panel calls `refresh()` before showing. [clock bar widget](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/clock/BarWidget.qml#L63-L144), [clock open/refresh lifecycle](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/clock/Panel.qml#L87-L140)

Follow that shape for `BarWidget.qml` plus a sibling popup component. Use one `KeyboardPanel` whose content mode controls its fitted width/height:

- compact Timer tab;
- compact Projects tab;
- expanded Calendar/Day Entries mode.

This keeps click/open behavior aligned with the main clock, participates in the bar's one-popout coordinator, avoids a second independent window lifecycle, and lets an Expanded/Back action retain selection and draft context. The bar-facing root must expose the same `open`/`close`/`opened` shape so `shell summon`, panel switching, and the open-panel indicator behave normally. This shape is a source convention, not part of the documented manifest schema.

`KeyboardPanel` is a layer-shell surface, not a normal `PopupWindow`. It primes exclusive keyboard focus, settles to on-demand focus, constrains the card to the available screen, coordinates with the active bar popout, dismisses on outside click, and creates dismissal surfaces on other monitors. Reuse it rather than rebuilding those details. [KeyboardPanel behavior](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Ui/KeyboardPanel.qml#L1-L120), [focus and popout lifecycle](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Ui/KeyboardPanel.qml#L222-L280)

Treat logical `open()` as this plugin's “focus gained” boundary: call the service refresh before showing, start visible polling only after registration, and unregister on close. Omarchy's current panel closes on outside interaction, so a later focus is a later open. Do not build correctness around incidental Wayland focus transitions. Refresh after every CLI completion as well. The agreed approximately 15-second visible interval matches the first-party pattern of guarded polling plus a watchdog, but it is a product policy rather than an Omarchy API. [first-party poll/refresh pattern](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/tailscale/Service.qml#L389-L435)

### Calendar composition to borrow

The built-in calendar supplies the native visual grammar rather than a reusable calendar control. It uses:

- a centered, screen-fitted `KeyboardPanel` at a nominal `Style.space(560)` width;
- a `Flickable` fallback for screens narrower than the fixed grid;
- a large today hero, small-caps metadata, a seven-column/six-row month grid, and bottom month navigation;
- local `SystemClock` updates across midnight;
- arrow/hjkl month/year navigation and Escape/Tab behavior through `PanelKeyCatcher`;
- theme-derived sizes, fonts, foregrounds, borders, and state colors.

[clock panel frame and keyboard wiring](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/clock/Panel.qml#L225-L282), [clock month-grid composition](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/clock/Panel.qml#L539-L700)

Do not copy two behaviors that conflict with this product. The built-in grid is deliberately read-only, while FreshBooks days must be selectable; and its week start is locale/configurable, while the project glossary fixes a Reporting Week to Sunday through Saturday. Use local FreshBooks dates, render Sunday first, attach the day's logged total/entry indicator to each cell, and make the selected day a persistent selected state distinct from the keyboard cursor.

## Process and synchronization seam

### Documented Quickshell behavior

`Process.command` is a list where every argument is separate and no shell is invoked. `stdout` and `stderr` accept parsers; `StdioCollector` is appropriate for a bounded JSON response, while `SplitParser` is for streaming delimited output. `onExited(exitCode, exitStatus)` is the completion boundary. Setting `running=false` sends SIGTERM. An ordinary `Process` is killed with Quickshell; `startDetached`/`execDetached` survives but is no longer tracked. [Quickshell `Process`](https://quickshell.org/docs/v0.3.0/types/Quickshell.Io/Process/), [Quickshell `SplitParser`](https://quickshell.org/docs/v0.2.0/types/Quickshell.Io/SplitParser/)

### Recommended adapter behavior

- Invoke `freshbooks` directly with an argument array. Never concatenate user notes, client names, or project names into `sh -c`.
- Require machine-readable JSON on stdout. Treat nonzero exit, signal exit, invalid JSON, schema mismatch, and a declared CLI error as different failure classes.
- Keep status/list refresh separate from the serial mutation lane. Coalesce refresh requests while one is running instead of starting overlapping copies.
- Use a watchdog for hung reads and mutations. After terminating or losing a mutation, mark its outcome unknown and reconcile from FreshBooks before offering retry.
- Make the CLI expose one Timer Switch command that logs the current Active Timer before starting the selected Project Shortcut. Splitting that invariant across two independent QML `Process` objects makes reload/death between calls harder to recover from.
- On successful mutations, adopt the command response immediately and then refresh. On failure, retain the prior confirmed snapshot and persistent actionable error.
- For a running Duration Correction, commit on Enter/blur, display saving state, and only rebase the local ticking anchor from the FreshBooks-confirmed response.
- Refresh on popup open, after every operation, and about every 15 seconds while any popup is open. Tick the display locally with `SystemClock.Seconds` between refreshes; it is presentation, not authority. [Quickshell `SystemClock`](https://quickshell.org/docs/v0.3.1/types/Quickshell/SystemClock/)

When refreshed remote data arrives during notes/duration editing, the service should retain the server snapshot and the local draft separately. Unedited fields can adopt remote state; edited fields surface the agreed Reload/Apply Mine choice. This conflict model belongs in the service so compact and expanded views cannot disagree.

## State and restart seam

Omarchy's `shell.json` is for plugin enablement, bar placement, and small inline widget preferences. It is not a timesheet database. The plugin checkout is source. [persisted shell state](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/README.md#L213-L281)

Quickshell exposes per-shell state/cache/data directories and `statePath`/`cachePath`; `FileView` can watch and atomically write small files, and `JsonAdapter` maps JSON fields to QML properties. `PersistentProperties` only carries properties across a Quickshell configuration reload; it is not durable machine-restart storage. [Quickshell paths](https://quickshell.org/docs/v0.3.1/types/Quickshell/Quickshell/), [Quickshell `FileView`](https://quickshell.org/docs/v0.3.0/types/Quickshell.Io/FileView/), [Quickshell `JsonAdapter`](https://quickshell.org/docs/v0.3.1/types/Quickshell.Io/JsonAdapter/), [Quickshell `PersistentProperties`](https://quickshell.org/docs/v0.2.0/types/Quickshell/PersistentProperties/)

Recommended storage division:

| Location | Contents | Authority |
| --- | --- | --- |
| `shell.json` inline entry | small user preferences that should appear in Omarchy's widget settings | user preference |
| `Quickshell.statePath("kmorey.freshbooks-time.json")` | versioned unsaved note/duration draft and minimal recovery metadata | local draft only |
| `Quickshell.cachePath("kmorey.freshbooks-time.json")` | recent project ordering and last successful read snapshots for fast paint | disposable cache |
| FreshBooks via `freshbooks-cli` | Active Timer and Time Entries | authoritative |

On service creation or shell restart, paint cache as stale if desired, immediately query FreshBooks, and replace the Active Timer snapshot. Never reconstruct or advance an Active Timer solely from a local file. A hot reload destroys and recreates plugin services in the current shell source, so this same reconciliation rule applies during development. [service unload/reload path](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/shell.qml#L734-L778), [automatic local-plugin reload](https://omarchy.org/manual/shell-plugins/)

## Theme and component seam

### Source convention

First-party plugins import `qs.Commons` and `qs.Ui`. `Color` exposes foundational and surface palette roles, including popup background/text/border, while `Style` exposes theme-reactive rounding, gaps, normal/hover-cursor/selected/focus state tokens, spacing, typography, and bar dimensions. [Color roles](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Commons/Color.qml#L1-L87), [Style tokens](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Commons/Style.qml#L1-L220)

Use Omarchy's `WidgetButton`, `BorderSurface`, `Button`, `ButtonGroup`, `TextField`, `NumberField`, `SearchableDropdown`, `PanelActionButton`, `PanelSeparator`, `PanelToolTip`, and `ConfirmDialog` where their current contracts fit. Bind all geometry through `Style.space`/spacing tokens, typography through `Style.font`, surfaces through `Color` roles, and interaction through Style's shared state helpers. This provides live theme response and native density without plugin-specific color constants.

However, neither the official manual nor `shell/README.md` declares `qs.Ui`/`qs.Commons` a versioned public SDK. These components and `bar.shell.serviceFor()` are source-level dependencies. Keep them behind a thin UI/service-access layer and run compatibility smoke tests against each supported Omarchy release. If a future 4.x release breaks them, adapt the layer rather than forking Omarchy or silently degrading.

## Keyboard seam

`KeyboardPanel` hands focus to a `focusTarget` on open. `PanelKeyCatcher` translates arrows and hjkl into movement, Enter/Space into activation, Escape into close, Tab/Shift+Tab into neighboring-panel handoff, `x` into a delete request, and arbitrary single characters into panel commands. When an editor or dropdown owns focus, its `blocked` property must be true so descendant controls receive their keys. [focus target behavior](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Ui/KeyboardPanel.qml#L55-L61), [PanelKeyCatcher contract](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Ui/PanelKeyCatcher.qml)

For this plugin:

- maintain one logical cursor (`focusSection`, `selectedIndex`) for tabs, project rows, timer actions, calendar days, and entry rows;
- synchronize mouse hover with the same cursor rather than painting a second highlight;
- use left/right on the tab strip to switch Timer/Projects, retaining Tab for Omarchy panel handoff when not editing;
- use arrow/hjkl movement and Enter/Space activation in the project list and calendar;
- block the catcher while notes, duration, search, dropdowns, or confirmation dialogs own focus;
- keep selected Active Timer/day/entry visuals distinct from the transient keyboard cursor;
- require confirmation for deletion even if `x` is the shortcut.

The built-in clock demonstrates blocking the catcher during inline fields, restoring focus with `Qt.callLater`, and resetting incomplete edit UI on close. [clock inline-edit focus handling](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/clock/Panel.qml#L169-L218), [clock catcher wiring](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/plugins/panels/clock/Panel.qml#L236-L265)

## IPC and launch seam

Omarchy documents a shell IPC target with `summon`, `hide`, `toggle`, and `call`, and permits plugins to register their own `IpcHandler` targets. QML IPC arguments are strings, so structured payloads should be JSON text. [shell IPC contract](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/README.md#L168-L211)

The first release does not need a broad public IPC API, but a small target is useful for hotkeys and diagnostics. Suggested read/command surface:

- `open`, `close`, `toggle` for the compact popup;
- `openCalendar [date]` for expanded calendar/history;
- `refresh`;
- `status` returning bounded JSON with readiness, active-timer summary, and last error, but no credentials or full note history.

Bar widgets exist once per monitor and an IPC target only routes to one live handler, so UI-affecting methods must broadcast to sibling widget instances or delegate to the singleton service. The base `BarWidget.broadcast()` exists specifically for this issue. [bar-widget broadcast](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/shell/Ui/BarWidget.qml#L25-L35)

## Testing and release seams inferred from first-party practice

Omarchy keeps pure calendar/state transformations in JavaScript (`Model.js`) and tests them outside the QML view, while runtime smoke tests launch the shell under a compositor and exercise plugin discovery, hot reload, IPC, and service status. [clock model tests](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/test/shell.d/clock-test.sh), [runtime shell smoke test](https://github.com/omacom/omarchy/blob/b71dcad96e9d0b2962b7d225828a5cb6000ad720/test/shell.d/runtime-smoke-test.sh)

Follow that split:

- pure tests for calendar generation, Sunday-week totals, recency sorting, elapsed-time rebasing, mutation state transitions, and conflict detection;
- adapter tests against a fake `freshbooks-cli` executable that controls stdout/stderr/exit/timeouts;
- `omarchy plugin validate .` in CI;
- QML/runtime smoke coverage for service creation, per-monitor widgets, popup focus, IPC, theme changes, and hot reload;
- manual validation on Omarchy 4 for horizontal/vertical bars, multiple monitors, narrow screens, keyboard-only flow, shell restart during a running remote timer, and remote web/mobile changes.

## Decisions this research enables

1. Package the repository itself as a root-manifest Omarchy plugin with `service` + `bar-widget`; do not create a separate Quickshell process.
2. Put FreshBooks authority and every CLI process in the singleton service; treat all QML views as projections/editors.
3. Use the clock's nested `KeyboardPanel` shape and expand that same popup for the calendar rather than introducing an unrelated window.
4. Refresh at logical open/focus, after mutations, and while visible; use a visible-consumer set because widgets are per-monitor.
5. Use tracked `Process` commands with argv arrays and JSON, and reconcile after ambiguous interruption.
6. Persist only preferences, drafts, and disposable cache outside the git checkout; always rehydrate the Active Timer from FreshBooks.
7. Reuse `qs.Ui`/`qs.Commons` for native theming and keyboard behavior, while explicitly treating them as an Omarchy 4 source compatibility dependency.
8. Publish from a stable default branch, validate every release, and document minimum tested Omarchy/CLI versions because the manifest cannot express them.

## Research provenance

Only first-party sources were used: the official Omarchy manual and `omacom/omarchy` repository, and official Quickshell documentation. The tagged v4.0.2 source and current `quattro` source were compared directly. No community plugin or secondary tutorial was used as authority. This folder is not a Git repository, so the research skill's throwaway branch/context-pointer workflow was unavailable; the report was written directly into the shared tree.
