QA Evidence — 20260824 — issue #7161 fallback provider exhaustion

## WHAT WAS TESTED

1. `bun test packages/model-core/src/model-error-classifier.test.ts` — classifier unit suite, including 4 new regression tests for Z.AI plan-limit exhaustion ("Weekly/Monthly Limit Exhausted. Your limit will reset at …", weekly-only and monthly-only variants, 429 statusCode variant, and negative cases where generic "monthly limit" phrasing without exhaustion stays a non-retryable STOP).
2. `bun test packages/omo-opencode/src/plugin/event.model-fallback.test.ts` — model-fallback event-handler suite, including 3 new/updated regression tests: (a) abort failure (no active stream) no longer short-circuits the fallback continuation dispatch; (b) full issue #7161 scenario — zai-coding-plan primary exhausted via session.error + throwing abort → user-configured chain cycles to first rung `opencode-go/glm-5.2`; (c) session.error missing `modelID` metadata resolves the actual session primary (`claude-opus-4-8`) instead of the hardcoded first-rung constant, so the next rung is a real fallback.
3. Failing-first proof: with only the three src fixes stashed (`git stash push -- packages/model-core/src/model-error-classifier.ts packages/omo-opencode/src/plugin/event-model-fallback-state.ts packages/omo-opencode/src/plugin/event-model-fallback.ts`) both suites were re-run against the new tests.
4. `bun run typecheck` (tsgo --noEmit across root script + all package tsconfigs).

## WHAT WAS OBSERVED

- Red (fixes stashed): classifier suite 40 pass / 3 fail; fallback-dispatch suite 17 pass / 3 fail. The failing tests are exactly the #7161 regressions (artifacts: `before-classifier-red.txt`, `before-fallback-dispatch-red.txt`).
- Green (fixes restored): classifier suite 43 pass / 0 fail; fallback-dispatch suite 20 pass / 0 fail (artifacts: `after-classifier-green.txt`, `after-fallback-dispatch-green.txt`).
- Typecheck exit code 0 across all tsconfigs (artifact: `after-typecheck-green.txt`).
- In the #7161 end-to-end scenario test, after session.error + failed abort, the injected prompt output carries `model = { providerID: "opencode-go", modelID: "glm-5.2" }` — the first configured fallback rung, proving the chain cycles instead of retrying the dead primary.

## WHY IT IS ENOUGH

The issue identifies three independent failure points; each now has a targeted fix plus a regression test that fails without its fix:
1. Classifier: `PROVIDER_PLAN_LIMIT_EXHAUSTED_PATTERN` is checked before `STOP_MESSAGE_PATTERNS`, so provider-announced weekly/monthly limit *exhaustion* is retryable while generic "monthly limit" phrasing from other providers remains a STOP (negative tests cover this boundary).
2. Abort short-circuit: `createModelFallbackContinuationController` proceeds with the fallback dispatch when `session.abort` throws (the exact post-quota-death state); duplicate-injection safety stays owned by the prompt-async gate.
3. Missing-metadata default: `resolveMissingMetadataModelID` prefers session model state over the static first-rung constant, so dedupe keys and re-arm checks reference the real failed primary.
Remaining risk: other providers may phrase quota exhaustion differently; those are unchanged behavior (still classified by existing patterns) and covered by the negative tests.

## WHAT WAS OMITTED

No live OpenCode harness drive was performed (no real API keys / paid providers available in this environment); verification is hermetic bun unit + typecheck evidence per task scope. No secrets, tokens, or env dumps are included — all artifacts are plain test/typecheck output. Pre-existing dirty state NOT touched or staged: `.omo/evidence/20260816-remove-omo-telemetry-command/*` terminal-ansi.txt files and `packages/shared-skills/upstreams/*` submodule pointers.
