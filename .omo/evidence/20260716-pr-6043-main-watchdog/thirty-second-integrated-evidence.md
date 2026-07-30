# Thirty-Second Integrated Evidence

## Exact Source

- Runtime repair: `3349c256b`.
- Evidence commit before integration: `c102dcd6f`.
- Fresh integrated `origin/dev`: `3a1b5f91a6e2628b66dfbaa9d9dca7c21269626d`.
- Merge commit under test: `f3acdc5cbb52ec14a6eed2743a07fcb3d6b3223b`.
- Merge second parent equals the fetched dev tip: yes.

## What Was Tested

1. Focused abort ownership and delta provenance:
   `bun test` over `abort-wire-ordering.test.ts`,
   `auto-retry-abort.test.ts`, and
   `first-prompt-watchdog-boundaries.test.ts`.
2. Complete `packages/omo-opencode/src/hooks/runtime-fallback` suite.
3. Main-session lifecycle, model-fallback boundary, plugin event, and
   session-state suites across five files.
4. `packages/omo-opencode` typecheck.
5. Biome 2.4.16 over the five repaired TypeScript files.
6. Bundled TypeScript no-excuse audit over the same five files.
7. Pure-line ceiling and `git diff --check`.
8. OpenCode QA common harness self-check.
9. The PR-specific production-duration isolated OpenCode server/SSE/fake
   provider scenario.

## What Was Observed

- Focused: `17 pass, 0 fail`, 36 expectations.
- Full runtime-fallback: `332 pass, 0 fail`, 667 expectations across 48 files.
- Lifecycle/model boundary: `66 pass, 0 fail`, 140 expectations across 5 files.
- Typecheck, Biome, no-excuse, pure-line, and diff integrity: pass.
- No repaired file exceeds 188 pure lines.
- OpenCode harness self-check: dependencies, DB lookup, SQL escaping, free
  port, isolated HOME/XDG, shim preservation, and automatic sandbox removal
  all pass.
- Production run terminal receipt:
  `PASS source_head=f3acdc5cbb52ec14a6eed2743a07fcb3d6b3223b
  real_db_unchanged=yes older_root_fallback=yes two_active_roots=yes
  deletion_restored_older=yes fallback_watchdog_rearmed=no
  later_user_abort=external`.
- The SSE watcher, OpenCode server, fake provider, and temporary sandbox were
  terminated or removed by the harness cleanup trap.

Sanitized exact-run artifacts are the refreshed `live-*` files in this
directory, including provider, plugin, SSE, root-state, and isolation receipts.

## Why It Is Enough

The tests exercise the two repaired boundaries deterministically and protect
the surrounding retry state machine. The integrated suites cover sibling
model-fallback and root lifecycle behavior after current dev was merged. The
real OpenCode run proves plugin loading, server and SSE delivery, production
watchdog timing, fallback dispatch, later genuine cancellation, database
isolation, and cleanup on the exact integrated runtime source.

## What Was Omitted

No secret-bearing raw logs, auth headers, environment dumps, or local session
identifiers are retained. Local-only dummy credentials are not reproduced.
The final PR head may add only this reviewer-readable evidence commit; runtime
source remains byte-identical to the exact source exercised above.
