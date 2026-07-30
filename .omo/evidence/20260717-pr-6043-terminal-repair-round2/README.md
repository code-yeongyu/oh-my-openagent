# PR 6043 Terminal Repair Round Two

## Identity

- Staged code tree: `418b5933d5a44ca8fd89ba82d999b68e05a23172`.
- Parent repair commit: `02972b520a8aff2c0ba0041e0ea7b32ed73a6ed0`.
- Integrated base at test time: `fe1c3dfb1ccd118a303130b113061f92fbee96ad`.
- The evidence is intentionally recorded before the final evidence commit; the staged code tree binds every result to the reviewed source.

## What Was Tested

1. Focused ownership, abort-ordering, multi-generation, and terminal-race tests.
2. The complete runtime-fallback test directory and directly coupled prompt/status boundaries.
3. Strict typechecks for `packages/omo-opencode` and `packages/utils`, `git diff --check`, and the 250 pure-line ceiling for every touched TypeScript file.
4. The OpenCode QA harness self-check, isolated server and SSE probes, and isolated tmux TUI smoke.
5. A real isolated OpenCode server with the local plugin, a silent fake provider, two active root sessions, watchdog fallback, root restoration after deletion, and a later genuine user abort.

## What Was Observed

- Focused races: 14 pass, 0 fail, 56 expectations.
- Runtime fallback: 340 pass, 0 fail, 686 expectations across 50 files.
- Shared boundaries: 83 pass, 0 fail, 179 expectations.
- Both package typechecks and `git diff --check` passed; all touched TypeScript files are at or below 250 pure lines.
- OpenCode server health reported 162 documented paths and rejected unauthenticated access; SSE delivered `server.connected`; the TUI rendered, accepted input, tore down tmux, and left the host DB unchanged at 5751 sessions.
- Live watchdog QA observed the older root fall back while a newer root existed, restored the older root after deleting the newer root, did not rearm after a successful response, and classified the later user abort as external cancellation.

## Why It Is Enough

The tests cover the exact rejected-dispatch, stale-status, stop/new-user ABA, delayed-abort, completed-generation, and ownership rollback transitions found by independent reviewers. The live harness proves the repaired code is wired into real OpenCode lifecycle events and preserves host isolation.

## What Was Omitted

Raw server stdout/stderr, unsanitized SSE, local ports, temporary paths, credentials, and raw session IDs were deleted. Reviewer-readable sanitized receipts remain in this directory.
