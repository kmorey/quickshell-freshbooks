# Local Wayfinder tracker

This project did not have a configured issue tracker when the map was charted, so issues are stored as Markdown files in `issues/`.

- Front matter records issue identity, status, labels, assignee, and parent.
- A blank assignee means the issue is unclaimed.
- `Blocked by` is the local fallback for dependency relationships.
- An issue is on the frontier when it is open, unclaimed, and every issue blocking it is closed.
- Resolution answers are appended under `## Resolution` before an issue is closed.
