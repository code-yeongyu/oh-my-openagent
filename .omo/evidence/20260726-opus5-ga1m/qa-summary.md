# Claude Opus 5 GA 1M context QA

## What was tested

- Loaded this branch's `packages/omo-opencode/src/index.ts` in a real OpenCode server under isolated XDG data, config, cache, and state directories.
- Drove `anthropic/claude-opus-5`, `anthropic/claude-opus-5-fast`, and the documented `amazon-bedrock/us.anthropic.claude-opus-5` identity through local isolated providers and the real OpenCode message and bash-tool path at 200,000 and 790,000 input tokens.
- Captured SSE proving no auto-compaction after the below-threshold turn, then an `auto: true` compaction part and `session.compacted` after the above-threshold turn.
- Added a production-hook regression test for the preemptive-compaction path. The same `claude-opus-5` session remains below the 78% threshold at 200,000 input and cache-read tokens, then triggers exactly one summarize call at 790,000 tokens.
- Ran the focused resolver and preemptive-compaction suites, including all Opus and Sonnet 4.6, 4.7, and 4.8 `-fast` aliases plus the production compaction decision for `claude-opus-4-8-fast`.
- Added resolver and production-hook regression coverage for regional AWS Bedrock IDs such as `us.anthropic.claude-opus-5`.
- Re-loaded the final code through an isolated real OpenCode server after the Bedrock normalization change, then drove the documented `amazon-bedrock` provider identity end to end.
- Added a regression proving the multi-model `amazon-bedrock` provider keeps non-Claude IDs on their cached limit even when all Anthropic 1M flags are enabled.
- Re-loaded the final restricted-classification code through an isolated real OpenCode server with both Claude and non-Claude Amazon Bedrock catalog identities.
- Ran package TypeScript checks with `bun run typecheck:packages`.
- Scoped native Anthropic 1M overrides away from `amazon-bedrock`, then verified the exact cached 200K Haiku identity under all three Anthropic override signals in both the resolver and production preemptive-compaction hook.
- Re-loaded the final revision in an isolated real OpenCode server with the native Anthropic 1M beta state and both Anthropic 1M environment flags enabled, then drove the cached-200K Amazon Bedrock Haiku identity through a real 160K message, bash-tool, automatic-compaction, and SSE path.
- Drove the new 4-series `-fast` classification itself through an isolated real OpenCode server with `anthropic/claude-opus-4-8-fast`, with no `anthropic-beta` header, no cached model limit, and both Anthropic 1M environment flags unset, so the GA 1M limit could only come from the new `-fast` arm.

## What was observed

- Real OpenCode v1.18.5 reported `healthy: true` with the worktree plugin URI present in `/config`.
- Sessions `ses_06373d6f5ffehNws4s2eB0K01l` (base ID) and `ses_0635f34beffeeBQQfxCFgG0Gev` (`-fast` alias, final code) completed the 200K and 790K tool turns; SSE then emitted an automatic compaction part and `session.compacted`.
- The real OpenCode database session count stayed at 4,329 before and after the isolated server run.
- Focused tests on the final code: 45 pass, 0 fail. This includes all 4.6, 4.7, and 4.8 Opus/Sonnet `-fast` aliases, `claude-opus-5`, `-0`, `.0`, `[1m]`, `-high`, `-fast`, `@default`, bare and regional AWS Bedrock IDs, cached-limit lookup, genuine 200K-model guards, and the production compaction decision path.
- The Bedrock production-hook test and real OpenCode run stayed below threshold at 200K for `amazon-bedrock/us.anthropic.claude-opus-5`, then summarized exactly once at 790K and emitted `session.compacted`.
- The final-code OpenCode source-load smoke returned healthy, exposed the worktree plugin URI, and loaded both `us.anthropic.claude-opus-5` and `openai.gpt-5.6-sol` under `amazon-bedrock`; the host DB remained at 4,329 sessions before and after.
- The non-Claude regression returned its cached 272K limit despite `anthropicContext1MEnabled`, `ANTHROPIC_1M_CONTEXT`, and `VERTEX_ANTHROPIC_1M_CONTEXT` all being enabled, while the documented Claude identity remained on the GA 1M path.
- Package typecheck exited successfully.
- The cached `amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0` limit remained 200K despite the model-cache flag and both Anthropic 1M environment flags; at 160K usage, the production hook summarized exactly once.
- The final isolated real-harness session `ses_06328f097ffecOs41DtHkfxsiN` used `amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0` with `anthropicContext1MEnabled`, `ANTHROPIC_1M_CONTEXT`, and `VERTEX_ANTHROPIC_1M_CONTEXT` all enabled. At 160K input tokens the real bash tool completed, SSE emitted an `auto: true` compaction part and `session.compacted`, and the host DB remained at 4,329 sessions before and after.
- The 4-series fast session `ses_02969761affeprpY8nOmmyXXhl` on OpenCode v1.18.14 completed the 200,000-token bash-tool turn with no compaction part and no summarize request, then emitted an `auto: true` compaction part and `session.compacted` after the 790,000-token turn. The host DB stayed at 4,821 sessions before and after.

Exact captured output:

- `opencode-source-load.txt`
- `real-opencode-compaction.txt`
- `real-opencode-fast-alias.txt` (fresh final-code alias run)
- `real-opencode-amazon-bedrock.txt` (documented 1M Opus provider identity through real message/tool/SSE path)
- `real-opencode-amazon-bedrock-haiku-200k.txt` (final cached-200K Haiku path at 160K with all three 1M signals enabled)
- `real-opencode-4series-fast-alias.txt` (representative 4-series `-fast` identity `claude-opus-4-8-fast` through the real message, bash-tool, and SSE path)
- `focused-tests.txt`
- `typecheck-packages.txt`

## Why it is enough

The resolver tests pin the model-ID classification, including 4-series `-fast` aliases, Bedrock namespace and regional-prefix normalization, multi-model-provider discrimination, and Amazon Bedrock cache precedence over native Anthropic override flags, while the hook-level tests pin the user-visible consequence: 200K usage must not cause premature compaction for GA 1M `claude-opus-4-8-fast` and Opus 5 sessions, and usage above 78% of 1M must still compact. The isolated OpenCode interactions prove the same decision through real message, tool, SSE, and `session.summarize` paths without touching the user OpenCode state. The real message-path runs specifically prove both the catalogued `claude-opus-5-fast` alias and documented `amazon-bedrock/us.anthropic.claude-opus-5` identity take the 1M threshold path. The final real OpenCode Haiku run closes the cache-precedence path end to end: despite all three 1M signals, the exact cached-200K Amazon Bedrock identity compacted at 160K through the real message, bash-tool, `session.summarize`, and SSE path. Focused resolver and production-hook tests also directly cover the exact `aws-bedrock-anthropic/us.anthropic.claude-opus-5` identity and cached-limit path.

The 4-series `-fast` arm is proven the same way rather than by unit test alone: the `anthropic/claude-opus-4-8-fast` run withheld every other route to the GA 1M limit, so the observed absence of compaction at 200,000 tokens and its presence at 790,000 tokens is attributable to that arm.

## What was omitted

No external provider request or credential was needed. The deterministic local provider supplied usage metadata and compaction output over localhost. No credentials, environment dumps, auth headers, or private configuration were captured, and the isolated XDG sandbox was removed after capture.

## Residual risk observed in the real harness

The real summarize request was queued behind the in-flight tool turn. The plugin timeout fired at 60 seconds shortly before OpenCode completed the queued summary and emitted `session.compacted`. This pre-existing queue/timeout interaction is recorded rather than hidden; it does not change the threshold proof requested for this model-classification PR.
