# PR 6043 Terminal Repair Evidence

## Identity

- Integrated base merge head before repair: `35ed40ca2f1445b8804b1fcedc671be68c120f24`.
- Reviewed code-only Git tree: `c5d22edbe6f1414599031d4325529bc57dd4973a`.
- Live PR source before repair: `2dd498b7f006f76c30ddaf8b143a3791fbf70982`.
- Integrated `origin/dev`: `fe1c3dfb1ccd118a303130b113061f92fbee96ad`.

## What Was Tested

1. Five failing-first race regressions: stop during status resolution, replayed user event, rejected watchdog abort, rejected replacement dispatch, and inconclusive status lookup.
2. Full runtime-fallback plus prompt-gate boundary matrix.
3. Strict TypeScript checks for `omo-opencode` and `utils`.
4. OpenCode QA harness self-check, server/SSE self-test, and tmux TUI smoke in isolated XDG/HOME sandboxes.
5. Real OpenCode server + SSE run against the local plugin and a silent fake provider.

## What Was Observed

- Regression tests: 5 pass, 0 fail.
- Focused matrix: 421 pass, 0 fail, 857 expectations across 61 files.
- Both package typechecks passed; `git diff --check` passed.
- SSE delivered `server.connected`; server health exposed 162 documented paths and rejected unauthenticated access.
- TUI rendered, accepted input, tore down tmux, and left the host DB count unchanged at 5751.
- Live watchdog receipt: isolated sandbox, host DB unchanged, watchdog fallback observed, active-root restoration observed, no post-success rearm, later user abort classified external.

## Why It Is Enough

The regression tests cover each reproduced ownership failure at its exact await/event boundary. The full matrix protects existing retry and prompt-queue behavior. The live run proves the plugin receives real OpenCode lifecycle events and performs fallback, root restoration, and cancellation classification without touching host state.

## What Was Omitted

Transient server stdout/stderr, raw SSE, local ports, temporary paths, credentials, and unsanitized plugin logs were deleted. The committed receipts replace session IDs and paths with stable placeholders.
