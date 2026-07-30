# PR #6043 Superseding Final Repair QA

Date: 2026-07-17

## Exact Source

- Repair commit: `dc09262dd735fac8a4fb014fa02e909cecdba607`
- Integrated base: `b56483fc77d7d8b0e184e7b98914c1ef46f1b125`
- `source-identity.txt` records the exact repair tree and merge base.
- This directory supersedes round four, whose stale invalidation released a
  newer replacement abort's session-scoped ownership.

## What Was Tested

- `abort-aba-red.txt` / `abort-aba-green.txt`: cleanup permits a replacement
  abort, then the stale request resolves; the replacement ownership count and
  terminal classification must remain intact.
- `stale-cleanup-reproduction.txt`: a late stale abort cannot recreate fallback
  state or dispatch after cleanup.
- `stale-status-red.txt` / `stale-status-green.txt`: a newer user turn
  invalidates an older resolving status transaction before abort or dispatch.
- `runtime-fallback-suite.txt`: complete runtime-fallback component suite.
- `shared-boundaries.txt`: prompt-gate, session state, and model-fallback tests.
- `static-gates.txt`: repository no-excuse audit, scoped Biome lint, OpenCode
  adapter typecheck, diff integrity, and pure LOC.
- `harness-self-check.txt`, `tui-smoke.txt`, and the live watchdog artifacts:
  isolated harness/TUI plus real OpenCode server, plugin, SSE, and production
  watchdog timing.

## What Was Observed

- Runtime fallback: 344 pass, 0 fail, 696 expectations across 50 files.
- Shared boundaries: 33 pass, 0 fail.
- The ABA regression is red before the repair and green afterward. A stale
  request returns false without decrementing ownership acquired by its newer
  replacement.
- No no-excuse violations were found in 65 PR-changed TypeScript files. Biome
  reported three pre-existing informational literal-key suggestions and no
  errors. Typecheck and `git diff --check` passed. Both current repair files
  stay under the 250 pure-LOC ceiling.
- The isolated TUI rendered and accepted input while the real DB stayed at
  5,751 sessions.
- The production-duration run loaded the local repository plugin, observed
  `server.connected` and lifecycle traffic, dispatched the silent-primary
  fallback, preserved multi-root ownership, did not re-arm after visible
  completion, classified a later user abort as external, and left the real DB
  unchanged.

## Why It Is Enough

The final repair covers all three discovered concurrency boundaries: new user
generation invalidation, stale cleanup invalidation, and cleanup/replacement
ABA ownership. The full suite protects the surrounding abort, terminal,
timeout, retry, and provider behavior. The live proof drives the real OpenCode
server and plugin for the configured production watchdog duration.

## Omitted Or Substituted

- The generic empty-config server/SSE helpers were not rerun in round five.
  Their local OpenCode 1.17.13 authenticated health request previously listened
  but did not return because the helper curl has no per-request timeout. The
  bounded live-plugin run supplies stronger server-health and SSE evidence,
  including `server.connected` and actual user/assistant lifecycle events.
- Raw streams, generated credentials, session identifiers, temporary sandbox
  paths, and unfiltered logs were removed. Retained outputs are sanitized.
