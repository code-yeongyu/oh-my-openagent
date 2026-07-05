# QA Evidence: fix-5815

## What was tested

- Failing-first regression: `PATH="$HOME/.bun/bin:$PATH" bun test packages/model-core/src/runtime-fallback-error-classifier.test.ts`
- Full package suite: `PATH="$HOME/.bun/bin:$PATH" bun test packages/model-core`
- Typecheck: `PATH="$HOME/.bun/bin:$PATH" bun run typecheck`
- Real-surface classifier proof: `PATH="$HOME/.bun/bin:$PATH" bun .omo/evidence/20260704-fix-5815/classifier-proof.mjs`
- OpenCode QA scope check: `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check`

## What was observed

- `red-runtime-fallback-classifier-test.txt`: the new regression failed before the product change because `isRuntimeFallbackRetryableError({ message: "Free usage exceeded, subscribe to Go" }, ...)` returned `false`.
- `green-runtime-fallback-classifier-test.txt`: the same test passed after adding `/free.?usage/i` and `/usage.?exceeded/i` to `RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS`.
- `classifier-before.json`: before the fix, the exact message classified as `{ "type": null, "retryable": false }`.
- `classifier-after.json` and `classifier-proof-after.txt`: after the fix, the exact message classified as `{ "type": null, "retryable": true }`.
- `bun-test-packages-model-core.txt`: 285 model-core tests passed.
- `bun-run-typecheck.txt`: repository typecheck passed.
- `opencode-qa-common-self-check.txt`: OpenCode QA helper dependencies and isolated sandbox support passed.

## Why it is enough

The defect is in the pure runtime-fallback classifier used by the OpenCode runtime-fallback hook. The failing-first test proves the current classifier missed the exact provider message, and the after-fix proof shows the same workspace package now reports it retryable without classifying it as `quota_exceeded`. That keeps the fix in the retryable path and avoids changing quota abort behavior.

## What was omitted

- No live provider quota exhaustion was forced, because the issue is a deterministic classifier gap and the faithful low-cost surface is the workspace package classifier import.
- No secrets, tokens, provider logs, or auth-bearing OpenCode logs were captured.
- `bash script/agent/setup.sh` was attempted first. It installed dependencies, then failed in the build phase because local provenance submodules use `file` transport that this Git invocation rejected. The requested test and typecheck gates passed after dependency installation.
