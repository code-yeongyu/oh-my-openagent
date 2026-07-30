# Thirty-Third Integrated Evidence

## Exact Source

- Reviewed PR parent: `18c96c582a508efb3d2281d66f4ddaa55922c694`.
- Fresh fetched `origin/dev`: `89fb8a42fdb55ef4672c89335ef15ffc71900695`.
- Merge commit under test: `598eee0df138b81d6156a58895ebd7bc52cf18c4`.
- The merge commit's second parent equals the fetched dev tip: yes.

## What Was Tested

1. The three focused abort-ownership and delta-provenance test files.
2. The complete `packages/omo-opencode/src/hooks/runtime-fallback` suite.
3. Five main-session lifecycle, model-fallback boundary, plugin event, and
   session-state test files.
4. The `packages/omo-opencode` strict typecheck.
5. Biome 2.4.16 and the bundled TypeScript no-excuse checker over the five
   files changed by the final runtime repair.
6. Pure-line counts and `git diff --check`.
7. The OpenCode QA common harness self-check.
8. The PR-specific production-duration isolated OpenCode server, SSE, and
   local fake-provider scenario.

## What Was Observed

- Focused tests: `17 pass, 0 fail`, 36 expectations across 3 files.
- Full runtime-fallback suite: `332 pass, 0 fail`, 667 expectations across
  48 files.
- Lifecycle and model-boundary suite: `66 pass, 0 fail`, 140 expectations
  across 5 files.
- Typecheck, Biome, no-excuse, pure-line, and diff-integrity gates passed.
- The largest repaired file is 221 lines.
- The OpenCode harness self-check passed dependency, database lookup, SQL
  escaping, free-port, isolated HOME/XDG, shim, and sandbox-removal checks.
- Production run receipt:
  `PASS source_head=598eee0df138b81d6156a58895ebd7bc52cf18c4
  real_db_unchanged=yes older_root_fallback=yes two_active_roots=yes
  deletion_restored_older=yes fallback_watchdog_rearmed=no
  later_user_abort=external`.
- The fake provider, SSE watcher, OpenCode server, and temporary sandbox were
  terminated or removed by the harness cleanup trap.

## Why It Is Enough

The deterministic tests cover the final abort-operation identity and event
provenance repairs plus the surrounding retry, disposal, compaction, model,
and root-session lifecycle contracts. The isolated real harness proves the
same integrated source through the actual OpenCode server and event stream at
the production watchdog duration, including later genuine cancellation and
database isolation.

## What Was Omitted

No raw environment dump, credential, auth header, local session identifier,
database path, or unsanitized server log is retained. The harness uses only a
loopback fake provider and fixed local dummy credentials.
