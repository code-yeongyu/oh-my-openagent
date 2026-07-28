# Senpi Live Task Status Refresh

## Goal

Keep running Senpi background-task status rows visibly updating while the parent is idle. Spinner frames, elapsed seconds, tool-call count, and tok/s must refresh through one bounded timer, and the timer must stop when no live background row remains.

## Constraints

- Fresh isolated worktree and PR into `dev`.
- Test-first RED→GREEN proof with deterministic clocks/timers and no sleeps.
- Preserve completed/no-active-task behavior without perpetual repaint.
- Use the existing task status controller and formatter; no new abstraction layer.
- Regenerate the shipped Senpi extension bundle.
- Capture a real PTY stream and xterm.js visual evidence.
- Merge with a merge commit and remove the worktree.

## Success Criteria

1. A deterministic test fails before the fix because a quiet running background task schedules no repaint, then passes after the fix with spinner, elapsed, tools, and tok/s advancing.
2. A regression test and mutation proof demonstrate the final background task leaves no active timer.
3. Scoped tests, package/root typecheck, build, and generated extension checks pass.
4. A real PTY stream contains multiple distinct production status rows during parent idle, and xterm.js renders the row without overflow or alignment drift.
5. Independent reviewers approve the implementation and evidence before PR handoff.
6. CI and required review gates pass, the PR merges into `dev`, and the worktree is removed.

## Implementation Sequence

1. Trace status update sources and identify the missing invalidation seam.
2. Pin terminal-only behavior with a characterization test.
3. Add the idle-running failing test and capture RED.
4. Add one periodic live-refresh handle to `createTaskStatusUi`.
5. Reuse that handle for child/store invalidations to avoid two concurrent UI timers.
6. Clear the timer on terminal/no-row/no-UI/non-TUI/dispose paths.
7. Capture GREEN, mutation proof, scoped verification, and generated bundle build.
8. Capture raw PTY updates and replay them through xterm.js.
9. Run criterion, code, security, QA, context, and visual reviews.
10. Commit, open the PR, pass CI/Cubic, merge, and clean the worktree.

## Evidence

All evidence is under `.omo/evidence/20260727-senpi-task-live-status/`.
