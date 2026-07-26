# Claude Opus 5 GA 1M context QA

## What was tested

- Loaded this branch's `packages/omo-opencode/src/index.ts` in a real OpenCode server under isolated XDG data, config, cache, and state directories.
- Drove `anthropic/claude-opus-5` and, after the final suffix fix, `anthropic/claude-opus-5-fast` through local isolated providers and the real OpenCode message and bash-tool path at 200,000 and 790,000 input tokens.
- Captured SSE proving no auto-compaction after the below-threshold turn, then an `auto: true` compaction part and `session.compacted` after the above-threshold turn.
- Added a production-hook regression test for the preemptive-compaction path. The same `claude-opus-5` session remains below the 78% threshold at 200,000 input and cache-read tokens, then triggers exactly one summarize call at 790,000 tokens.
- Ran the focused resolver and preemptive-compaction suites.
- Added resolver and production-hook regression coverage for regional AWS Bedrock IDs such as `us.anthropic.claude-opus-5`.
- Re-loaded the final code through an isolated real OpenCode server after the Bedrock normalization change.
- Ran package TypeScript checks with `bun run typecheck:packages`.

## What was observed

- Real OpenCode v1.18.5 reported `healthy: true` with the worktree plugin URI present in `/config`.
- Sessions `ses_06373d6f5ffehNws4s2eB0K01l` (base ID) and `ses_0635f34beffeeBQQfxCFgG0Gev` (`-fast` alias, final code) completed the 200K and 790K tool turns; SSE then emitted an automatic compaction part and `session.compacted`.
- The real OpenCode database session count stayed at 4,329 before and after the isolated server run.
- Focused tests on the final code: 39 pass, 0 fail. This includes `claude-opus-5`, `-0`, `.0`, `[1m]`, `-high`, `-fast`, `@default`, bare and regional AWS Bedrock IDs, cached-limit lookup, genuine 200K-model guards, and the production compaction decision path.
- The Bedrock production-hook test stayed below threshold at 200K for `aws-bedrock-anthropic/us.anthropic.claude-opus-5`, then summarized exactly once at 790K.
- The final-code OpenCode source-load smoke returned healthy and exposed the worktree plugin URI; the host DB remained at 4,329 sessions before and after.
- Package typecheck exited successfully.

Exact captured output:

- `opencode-source-load.txt`
- `real-opencode-compaction.txt`
- `real-opencode-fast-alias.txt` (fresh final-code alias run)
- `focused-tests.txt`
- `typecheck-packages.txt`

## Why it is enough

The resolver tests pin the model-ID classification, including Bedrock namespace and regional-prefix normalization, while the hook-level tests pin the user-visible consequence: 200K usage must not cause premature compaction for a GA 1M Opus 5 session, and usage above 78% of 1M must still compact. The isolated OpenCode interactions prove the same decision through real message, tool, SSE, and `session.summarize` paths without touching the user OpenCode state. The real message-path run specifically proves the catalogued `claude-opus-5-fast` alias takes the 1M threshold path. The final-code isolated source-load smoke proves the Bedrock normalization revision loads through the real plugin entry, while focused resolver and production-hook tests directly cover the exact `aws-bedrock-anthropic/us.anthropic.claude-opus-5` identity and cached-limit path.

## What was omitted

No external provider request or credential was needed. The deterministic local provider supplied usage metadata and compaction output over localhost. No credentials, environment dumps, auth headers, or private configuration were captured, and the isolated XDG sandbox was removed after capture.

## Residual risk observed in the real harness

The real summarize request was queued behind the in-flight tool turn. The plugin timeout fired at 60 seconds shortly before OpenCode completed the queued summary and emitted `session.compacted`. This pre-existing queue/timeout interaction is recorded rather than hidden; it does not change the threshold proof requested for this model-classification PR.
