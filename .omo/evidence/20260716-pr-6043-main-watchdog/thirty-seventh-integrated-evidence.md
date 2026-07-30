# Thirty-Seventh Integrated Evidence

## Exact Source

- Previously live-tested integrated source:
  `6d64eaa81266cee435e8821a28c266cdd88a0a79`.
- Fresh fetched `origin/dev`:
  `955c614077e50185769cdf3410ee579b323a6754`.
- Final integration merge under deterministic test:
  `3b069303b32c72859b697f94a169f243c0a545e0`.
- Merge parents:
  `6d64eaa81266cee435e8821a28c266cdd88a0a79` and
  `955c614077e50185769cdf3410ee579b323a6754`.
- `packages/omo-opencode` tree at both the live-tested source and final
  integration: `2c9c67dadfc9b9724cb574465dceb42c71feaf91`.
- Incoming paths were limited to `docs/reference/known-issues.md` and
  `packages/omo-senpi/**`; no OpenCode adapter path changed.

## What Was Tested

1. Three focused abort-operation, wire-ordering, and event-provenance test
   files at the final integration.
2. The complete `packages/omo-opencode/src/hooks/runtime-fallback` suite at
   the final integration.
3. Five main-session lifecycle, model-fallback, plugin event, and session-state
   test files at the final integration.
4. The strict `packages/omo-opencode` typecheck.
5. Biome 2.4.16 and the repository-preserved TypeScript no-excuse checker over
   the five files changed by the last runtime repair.
6. Pure-line limits, `git diff --check`, merge-parent identity, and the
   OpenCode subtree-hash bridge.
7. The OpenCode QA common harness self-check with isolated HOME/XDG cleanup.
8. The production-duration isolated OpenCode server/SSE/fake-provider scenario
   at source `6d64eaa81266cee435e8821a28c266cdd88a0a79`, whose complete
   OpenCode subtree is byte-identical to the final integration.

## What Was Observed

- Focused tests: `17 pass, 0 fail`, 36 expectations across 3 files.
- Full runtime-fallback suite: `332 pass, 0 fail`, 667 expectations across
  48 files.
- Lifecycle/model boundary: `66 pass, 0 fail`, 140 expectations across
  5 files.
- Typecheck, Biome, no-excuse, pure-line, and diff-integrity gates passed.
- The largest final-repair file is 188 pure lines.
- The OpenCode harness self-check passed dependency, database lookup, SQL
  escaping, free-port, isolated HOME/XDG, shim, and sandbox-removal checks.
- Production run receipt:
  `PASS source_head=6d64eaa81266cee435e8821a28c266cdd88a0a79
  real_db_unchanged=yes older_root_fallback=yes two_active_roots=yes
  deletion_restored_older=yes fallback_watchdog_rearmed=no
  later_user_abort=external`.
- The live run proved active-root selection, older-root fallback, root
  deletion restoration, internal continuation ownership, top-level delta
  provenance, successful fallback without watchdog re-arm, later genuine
  cancellation, unchanged real OpenCode DB state, and cleanup.

## Artifacts

- `thirty-seventh-exact-focused-tests.txt`
- `thirty-seventh-exact-runtime-fallback-suite.txt`
- `thirty-seventh-exact-session-lifecycle-suite.txt`
- `thirty-seventh-exact-omo-opencode-typecheck.txt`
- `thirty-seventh-exact-biome.txt`
- `thirty-seventh-exact-no-excuse.txt`
- `thirty-seventh-exact-integrity.txt`
- `thirty-seventh-exact-opencode-harness-self-check.txt`
- `thirty-seventh-live-watchdog-bridge.txt`
- refreshed sanitized `live-*` provider and first-party plugin artifacts

## Why It Is Enough

All deterministic and static gates were rerun after the final `dev` merge.
The only incoming changes were documentation and the Senpi adapter, and Git
proves the complete OpenCode adapter tree is identical to the source exercised
through the real production-duration harness. Repeating the 90-second harness
would execute the same OpenCode bytes and would not add coverage for the
disjoint incoming delta.

## What Was Omitted

No raw environment dump, credential, auth header, local session identifier,
database path, raw database count, or unsanitized server log is retained. The
failed first lifecycle command selected an incomplete file set and was
superseded; the external no-excuse helper crashed in its own TypeScript import
path and was superseded by the repository-preserved working copy of the same
checker.
