# Stuck save recovery

## Status

A scoped watchdog fix is committed with this handoff. It addresses a demonstrated failure path: after the adapter's existing 15-second request timeout asks a child CLI process to terminate, a child that remains alive can keep the interactive request busy indefinitely. This is not a proven diagnosis of the live incident on `blitz`.

The remote save is still unresolved. No FreshBooks read, save retry, process signal, draft read/write, reload, or deployment was performed on `blitz`.

## Patch

`CliAdapter.qml` now gives a timed-out CLI process a 1-second termination grace period. The existing timeout still requests termination; if the child is still running when the grace timer fires, the adapter sends signal 9. The grace timer is stopped when a process finishes and before the next execution starts, so a completed or later request cannot receive a stale kill.

This permits the existing service timeout path to finish: it reports the timed mutation as an unknown outcome, removes queued mutations, and uses reconciliation reads rather than blindly retrying.

## Existing verification

A throwaway extraction harness exercised the real signal behavior with a Node child that ignores `SIGTERM`:

- Before this patch, the pending request remained indefinitely.
- With this patch, the request released after one kill signal.
- Normal completion stopped both timers.
- A later request was not affected by a prior grace timer.

The actual service timeout handler was also exercised: it moved the timed `log` request into unknown-outcome reconciliation, discarded queued mutations, and ignored a stale completion. There is no QML runtime in the current environment, so the actual Quickshell process lifecycle has not been run here.

## Safe recovery on blitz

Before pulling or activating anything, preserve the visible pending note and duration outside Quickshell. A pull can hot-reload the plugin; it must not be treated as recovery of the current save.

1. Inspect the live Quickshell/plugin processes and determine the installed plugin path and version. Also inspect the active child only with the least disruptive available observation. Do not assume this checkout, its symlink, or its activation/reload mechanism is the one `blitz` uses.
   - Completion: the running shell, installed plugin source, and any relevant child process are identified from observation.
2. Preserve the pending draft note and duration before any reload, shell restart, or child termination. Drafts are per-shell Quickshell state; FreshBooks is authoritative.
   - Completion: the values needed to recreate the entry are recorded safely.
3. Reconcile with FreshBooks using an authoritative read-only lookup covering the intended entry and relevant timer state. Determine whether the save already reached FreshBooks before submitting anything again.
   - Completion: there is direct evidence that the intended entry exists or does not exist; no retry has occurred merely because the UI remained pending.
4. If the child is verified stuck and recovery requires ending it, use the least disruptive termination that actually works. Reinspect afterward; do not terminate an unverified process.
   - Completion: the identified child has exited or a clearly recorded blocker remains.
5. Pull this branch and activate the patch only through the shell/plugin mechanism discovered in step 1. Do not guess a reload command.
   - Completion: the running plugin is confirmed to use the pulled commit.
6. Confirm the pending state clears and reconcile FreshBooks again. If step 3 showed no entry, resubmit once from the preserved draft, then verify exactly one matching FreshBooks entry. If it showed an existing entry, do not resubmit.
   - Completion: Quickshell has no stuck pending save, and FreshBooks has no lost or duplicate entry.

If the live state cannot be inspected safely, stop after preserving the draft and record the exact unavailable observation; do not infer that the watchdog patch alone resolved the remote save.
