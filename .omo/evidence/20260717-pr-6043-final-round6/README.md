# PR #6043 Final Round-Six Repair QA

Date: 2026-07-17

## Exact Source

- Repair commit: `df4bebeea516c7d7266f28f2c6b66b402d5eaaf3`.
- Integrated candidate: `30bccd89ca005a4220a518926004ccb9609347c9`.
- Integrated base: `14083b89f1cbf4680be13493a6c4afd67c957e8a`.
- This directory supersedes round five. Its final security review found that
  stale cleanup invalidated retry state but left the detached first-prompt
  watchdog generation eligible for rollback and re-arm.

## What Was Tested

- `stale-cleanup-watchdog-red.txt` reproduces the blocker before the repair:
  stale cleanup is followed by a late abort response and rollback deadline.
- `stale-cleanup-watchdog-green.txt` proves cleanup now cancels the watchdog
  generation before deleting shared retry state.
- `runtime-fallback-suite.txt` covers the complete runtime-fallback component.
- `shared-boundaries.txt` covers prompt-gate and model-fallback boundaries.
- `static-gates.txt` records no-excuse, Biome, OpenCode typecheck, commit diff
  integrity, and pure-LOC checks.
- `harness-self-check.txt`, `tui-smoke.txt`, and the live artifacts drive an
  isolated OpenCode harness, tmux TUI, real local plugin, server, SSE stream,
  and production-duration watchdog timing.

## What Was Observed

- The failing regression produced two aborts, one fallback dispatch, and
  recreated session state after cleanup. The repair produces one abort, no
  fallback dispatch, and no session state.
- Runtime fallback: 345 pass, 0 fail, 697 expectations across 51 files.
- Shared boundaries: 33 pass, 0 fail.
- No no-excuse violations were found in 66 changed TypeScript files. Biome,
  typecheck, and commit diff checks passed. Every repair file is below 250
  pure LOC.
- The TUI rendered and accepted input while the real database stayed at 5,751
  sessions.
- The exact-commit live run loaded the local plugin, observed lifecycle SSE,
  dispatched the silent-primary fallback, preserved multi-root ownership,
  did not re-arm after visible completion, classified a later user abort as
  external, and left the real database unchanged.

## Why It Is Enough

The regression composes the real status handler, cleanup helper, watchdog,
fake timers, and late abort completion at the race boundary that failed review.
The full component and boundary suites cover adjacent abort, terminal, retry,
timeout, and dispatch behavior. The isolated live run proves the shipped
OpenCode integration still behaves correctly at production timing.

## Omitted Or Substituted

- Raw server streams, generated credentials, temporary sandbox paths, and
  unfiltered logs were removed. Retained live outputs are sanitized.
- The Bun invocation of the shared no-excuse scanner currently resolves a
  namespace object without a default TypeScript export. The proven Node
  `--experimental-strip-types --preserve-symlinks-main` route ran the same
  unmodified scanner and passed all 66 files.
- Generic empty-config server/SSE helpers were not used because their local
  authenticated curl path lacks a per-request timeout. The bounded live-plugin
  run provides stronger server, SSE, hook, and behavior proof.
