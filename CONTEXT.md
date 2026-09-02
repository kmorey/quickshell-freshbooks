# FreshBooks Time Tracking

The language for recording and reviewing work time through the Omarchy plugin.

## Language

**Time Entry**:
A FreshBooks record representing either one segment of an unfinished timer or finalized work for a client and project, including its date, duration, and optional notes.
_Avoid_: Log, timesheet row

**Timer Segment**:
An unlogged Time Entry that contributes elapsed time to an Active Timer. Pausing and resuming can produce multiple segments sharing one timer identity.
_Avoid_: Separate timer, duplicate timer

**Active Timer**:
A logical FreshBooks timer composed of one or more Timer Segments sharing one timer identity. The plugin exposes at most one Active Timer at a time.
_Avoid_: Running entry, timer segment, project timer

**Project Shortcut**:
A project shown as a quick-start target in the timer interface, ordered using recent or frequent use.
_Avoid_: Task, saved timer

**Timer Switch**:
The transition that finalizes the current Active Timer as a Time Entry before starting a new Active Timer for another project.
_Avoid_: Parallel timer, timer swap

**Duration Correction**:
An explicit replacement of an Active Timer's total elapsed duration that is reflected in FreshBooks while the timer continues from the corrected value.
_Avoid_: Local offset, display adjustment

**Reporting Week**:
A Sunday-through-Saturday period whose day boundaries follow the local dates used by FreshBooks.
_Avoid_: ISO week, work week

**Billability**:
The project-defined classification inherited by its Time Entries rather than chosen during time tracking.
_Avoid_: Billing status, timer billing mode
