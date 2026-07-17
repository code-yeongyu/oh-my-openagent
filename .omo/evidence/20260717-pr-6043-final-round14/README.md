# PR #6043 Final Round 14 Evidence

## Source Identity

- Integrated exact head: `801aedfaa06daf090df57d1ddf676458ad1e1b2e`
- Runtime commit: `0e9ea8ff9c929ca2672064dfbc10b9219b9b50cb`
- Runtime tree: `41300676c55d178ff790cf2d0a829cb9483791b2`
- Integrated parent from current `origin/dev`: `8af398565abfaece6d5fc3e6bc4ef0c7efa9bb7a`
- The live harness ran at the integrated exact head, compares every repaired production/test path with the runtime commit, and records `source_matches=yes`.

## What Was Tested

1. Deterministic ordering regression: the watchdog abort resolves while `session.messages()` remains pending, then the abort terminal arrives before fallback prompt dispatch.
2. Cancellation boundary matrix: a genuine user cancellation during prompt settlement remains external and stops the newly accepted fallback request.
3. Full runtime-fallback suite, OpenCode adapter typecheck, scoped Biome lint, forbidden-pattern audit, pure-LOC ceiling, and `git diff --check`.
4. Production-duration isolated OpenCode QA using the real local plugin, `opencode serve`, HTTP API, SSE, and a local fake provider. The primary request remains silent through the real 90-second watchdog, fallback succeeds, the newer root is deleted and the older root is restored, then a second user turn is deliberately aborted.

## What Was Observed

- Focused ordering matrix: `6 pass`, `0 fail`.
- Full runtime-fallback suite: `361 pass`, `0 fail`.
- Typecheck and Biome: pass.
- All touched source/test files remain at or below 250 pure LOC.
- Live QA: exact source match, 90-second watchdog dispatch, internal primary abort, fallback response, no fallback-owned watchdog re-arm, later user abort classified external, and real OpenCode DB unchanged at 5,751 sessions.
- SSE: two `session.created`, one `session.deleted`, one `session.error`, and four `session.idle` records after sanitization.
- The receipt reports two fallback-provider requests because the second is the intentional hanging user-cancellation turn; the initial watchdog dispatched exactly one fallback retry.

## Why It Is Enough

The deterministic regression forces the newly found ordering that the prior live trace did not guarantee. The neighboring cancellation tests prove the marker lifetime does not extend into prompt settlement. The full hook suite covers adjacent abort, generation, timeout, cleanup, disposal, and fallback ownership behavior. The live run proves the same committed source through the real OpenCode adapter and production watchdog duration while preserving DB isolation.

## Artifacts

- `red-message-fetch-ordering.txt`: failing-first proof before the repair.
- `green-message-fetch-ordering.txt`: focused green proof after the repair.
- `focused-ordering-matrix.txt`: repaired ordering plus neighboring cancellation races.
- `runtime-fallback-suite.txt`: complete hook suite.
- `typecheck.txt`, `biome.txt`, `no-excuse.txt`, `pure-loc.txt`, `source-and-diff-check.txt`: static gates.
- `harness-self-check.txt`: OpenCode QA harness prerequisites and sandbox cleanup self-check.
- `run-live-watchdog-qa.sh`: exact-source production-duration harness.
- `live-watchdog-qa.txt`, `live-isolation-receipt.txt`: terminal live verdict and isolation receipt.
- `live-plugin-watchdog.txt`, `live-sse-events.jsonl`, `live-root-state.jsonl`, `live-fake-provider.txt`: sanitized behavior evidence.

## Omitted

Raw server stdout/stderr, temporary sandbox paths, unsanitized SSE streams, and “live-last” failure-diagnostic copies are intentionally not committed. No tokens, authorization headers, environment dumps, or private credentials are included.
