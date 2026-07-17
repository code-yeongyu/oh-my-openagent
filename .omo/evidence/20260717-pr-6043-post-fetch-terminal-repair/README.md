# PR #6043 Post-Fetch Terminal Repair Evidence

## Source Identity

- Reviewed PR head before repair: `c71b41c1574a191a51c7497da43c11d5d2aa9d0e`.
- Integrated base: `8af398565abfaece6d5fc3e6bc4ef0c7efa9bb7a`.
- Exact working source diff SHA-256 used by live QA: `7a7c0e2dff2e09100c8fee327680218560fa9cee38a24b215efb7f95ffab0582`.
- The source diff is limited to seven runtime-fallback production/test files.

## What Was Tested

1. The failing post-fetch race from `.omo/evidence/pr-6043-gate-review.md`: `session.messages()` has resolved, fallback `promptAsync` is busy, and the delayed watchdog abort terminal arrives.
2. The neighboring genuine-cancellation boundary while fallback dispatch is settling.
3. The complete runtime-fallback suite, OpenCode adapter typecheck, scoped Biome, forbidden-pattern audit, pure-LOC ceiling, and `git diff --check`.
4. Production-duration isolated OpenCode QA through `opencode serve`, the real local plugin, HTTP API, SSE, and a local fake provider.

## What Was Observed

- Focused terminal matrix: `10 pass`, `0 fail`.
- Busy replacement status consumes the delayed watchdog terminal internally and retains fallback ownership.
- Idle status resolves the abort shape as external cancellation, resets retry state, and stops the replacement request.
- Full runtime-fallback suite: `362 pass`, `0 fail` across 58 files.
- OpenCode adapter typecheck, Biome, forbidden-pattern audit, pure-LOC checks, and diff integrity passed. `first-prompt-watchdog.ts` remains at 249 pure LOC.
- The live 90-second watchdog aborted the silent primary request, dispatched one fallback retry, completed visibly, and did not re-arm the fallback-owned turn.
- A later real user abort was classified as external cancellation.
- The real OpenCode database remained unchanged at 5,751 sessions; the isolated sandbox contained one QA session and was removed.

## Why It Is Enough

The deterministic tests force the exact post-fetch ordering that the live provider cannot reliably schedule, while the composed-hook and generation tests prove the busy/idle decision boundary. The full suite covers adjacent generation, cleanup, timeout, provider-error, compaction, disposal, and retry-ownership behavior. The production-duration run proves that the same working source functions through the real OpenCode adapter without touching live user state.

## Artifacts

- `focused-terminal-matrix.txt`: exact busy/internal and idle/external boundary matrix.
- `runtime-fallback-suite.txt`: all affected hook tests.
- `typecheck.txt`, `biome.txt`, `no-excuse.txt`, `pure-loc.txt`, `source-and-diff-check.txt`: static and source-identity gates.
- `harness-self-check.txt`: OpenCode QA prerequisites and sandbox cleanup proof.
- `run-live-watchdog-qa.sh`: production-duration isolated harness.
- `live-watchdog-qa.txt`, `live-isolation-receipt.txt`: terminal live verdict and isolation receipt.
- `live-plugin-watchdog.txt`, `live-sse-events.jsonl`, `live-root-state.jsonl`, `live-fake-provider.txt`: sanitized behavior evidence.

## Omitted

Raw server output, unsanitized SSE, temporary sandbox paths, and readiness-poll noise are not retained beyond the summarized terminal log. No real tokens, authorization headers, environment dumps, or private credentials are included.
