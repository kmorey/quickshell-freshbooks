# FreshBooks Time Tracking

The language for recording and reviewing work time through the Omarchy plugin.

## Language

**Time Entry**:
A FreshBooks record of work performed for a client and project on a particular day, including its duration and optional notes.
_Avoid_: Log, timesheet row

**Active Timer**:
The single FreshBooks-backed work interval the plugin currently presents for a selected project and that has not yet been finalized as a Time Entry. FreshBooks may contain other unlogged timers, but the plugin exposes only one Active Timer at a time.
_Avoid_: Running entry, project timer

**Project Shortcut**:
A project shown as a quick-start target in the timer interface, ordered using recent or frequent use.
_Avoid_: Task, saved timer

**Timer Switch**:
The transition that finalizes the current Active Timer as a Time Entry before starting a new Active Timer for another project.
_Avoid_: Parallel timer, timer swap

**Duration Correction**:
An explicit replacement of an Active Timer's elapsed duration that is reflected in FreshBooks while the timer continues from the corrected value.
_Avoid_: Local offset, display adjustment

**Reporting Week**:
A Sunday-through-Saturday period whose day boundaries follow the local dates used by FreshBooks.
_Avoid_: ISO week, work week

**Billability**:
The project-defined classification inherited by its Time Entries rather than chosen during time tracking.
_Avoid_: Billing status, timer billing mode
