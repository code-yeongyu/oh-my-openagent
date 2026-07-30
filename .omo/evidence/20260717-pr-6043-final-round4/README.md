# PR #6043 Final Repair QA

Date: 2026-07-17

## Exact Source

- Repair commit: `b1f5d1b01ef335f7962b55b2396c21595f545cda`
- Integrated base: `b56483fc77d7d8b0e184e7b98914c1ef46f1b125`
- The source tree and merge base are recorded in `source-identity.txt`.

## What Was Tested

- `runtime-fallback-suite.txt`: the complete runtime-fallback test directory.
- `shared-boundaries.txt`: prompt-gate, model-fallback, and session-state boundaries.
- `stale-status-red.txt` / `stale-status-green.txt`: composed proof that a newer
  user turn invalidates an older resolving `session.status` retry.
- `stale-cleanup-reproduction.txt`: the reviewer-provided late abort reproduction
  after stale-session cleanup.
- `deferred-ordering-red.txt` / `deferred-ordering-green.txt`: failing-first proof
  that user-only invalidation preserves assistant deferred-terminal ordering.
- `static-gates-final.txt`: repository no-excuse audit over all changed TypeScript,
  scoped Biome lint, OpenCode adapter typecheck, diff integrity, and pure LOC.
- `harness-self-check.txt`, `tui-smoke.txt`, and the live watchdog artifacts:
  isolated OpenCode harness, tmux TUI, SSE, local plugin loading, and production
  watchdog timing.

## What Was Observed

- Runtime fallback: 343 pass, 0 fail, 691 expectations across 50 files.
- Shared boundaries: 33 pass, 0 fail.
- The stale cleanup reproduction finishes with zero retained abort requests,
  zero dispatches, zero commits, and no recreated fallback state.
- No no-excuse violations were found in 65 PR-changed TypeScript files. Scoped
  Biome emitted three pre-existing informational literal-key suggestions and no
  errors. Typecheck and `git diff --check` passed. All five repair files remain
  below the 250 pure-LOC ceiling.
- The isolated TUI rendered and accepted input; the real DB stayed at 5,751
  sessions.
- The production-duration local-plugin run observed `server.connected`, an
  older root watchdog fallback while two roots existed, restoration of the
  older root after deleting the newer root, no watchdog re-arm after visible
  completion, and a later user abort classified as external. The real DB count
  was unchanged.

## Why It Is Enough

The two reviewer blockers are covered at their production composition points:
generation invalidation on a new user event and exact-request invalidation after
stale cleanup. The full component suite protects adjacent deferred-terminal,
abort ownership, retry dispatch, timeout, and provider behavior. The live run
loads the repository plugin through real OpenCode server and SSE surfaces for
the configured production watchdog duration.

## Omitted Or Substituted

- The generic empty-config `server-smoke.sh` and `sse-hook-probe.sh` helpers
  listened but their authenticated health request did not return on this local
  OpenCode 1.17.13 install because the helper curl has no per-request timeout.
  They were terminated and left no process or sandbox. The bounded live-plugin
  run substituted stronger server health and SSE evidence, including an actual
  `server.connected` event and user/assistant lifecycle traffic.
- Raw server streams, generated credentials, session identifiers, temporary
  sandbox paths, and unfiltered plugin logs were removed. Only sanitized,
  reviewer-readable outputs are retained.
