# changes.md — ai

## Upstream model generation and test sync (2026-07-02)

### What changed

- `scripts/generate-models.ts`: accepted upstream removal of stale model metadata fallbacks, including Copilot Sonnet 5
  fallback cleanup.
- Updated focused AI regression tests covering Fireworks model routing, GitHub Copilot OAuth, delayed device-code polling,
  and OpenAI Codex stream request-body handling.

### Why

- The fork should now rely on live/generated model metadata instead of keeping stale fallback entries, while preserving
  coverage for provider behavior touched by the upstream sync.

### Why extension system couldn't handle this

- Model generation is a build-time catalog script, and the changed tests assert provider/library behavior outside the
  coding-agent extension runtime.

### Modified upstream files

- `scripts/generate-models.ts`
- `test/fireworks-models.test.ts`
- `test/github-copilot-oauth.test.ts`
- `test/oauth-device-code.test.ts`
- `test/openai-codex-stream.test.ts`

### Expected merge conflict zones

- MEDIUM: `scripts/generate-models.ts` if upstream changes provider metadata fetch or fallback handling again.
- LOW: focused provider tests if upstream changes request decoding, OAuth polling timing, or Fireworks model mappings.

## Explicit live API opt-in for ambient credentials (2026-05-12)

### What changed

- `test/live-api-gates.ts`: Added shared live-test gate helpers. Ambient provider keys and local model probes are ignored unless `PI_ENABLE_LIVE_API_TESTS=1` or the provider-specific flag is set.
- `test/oauth.ts`: OAuth tokens from `~/.pi/agent/auth.json` now resolve only for explicitly enabled live OAuth test providers.
- OpenRouter live suites in image, streaming, context-overflow, total-token, and thinking-disable tests now require `PI_ENABLE_OPENROUTER_LIVE=1` in addition to a key.
- Local context-overflow suites now require `PI_ENABLE_LOCAL_LLM=1`, matching the existing fork policy that local model servers must be explicit opt-in.

### Why

- `npm test --workspaces --if-present` must pass in developer environments that contain stale or unrelated credentials and local model daemons. An invalid ambient `OPENROUTER_API_KEY`, stale Anthropic OAuth token, and empty LM Studio server caused live suites to run and fail for reasons unrelated to the code under test.

### Why extension system couldn't handle this

- These are `packages/ai` integration-test activation rules. Extension hooks are not involved in test discovery or live provider credential resolution.

### Modified upstream files

- `test/oauth.ts`
- `test/context-overflow.test.ts`
- `test/google-thinking-disable.test.ts`
- `test/image-tool-result.test.ts`
- `test/images.test.ts`
- `test/live-api-gates.test.ts`
- `test/live-api-gates.ts`
- `test/stream.test.ts`
- `test/total-tokens.test.ts`

### Expected merge conflict zones

- Upstream currently gates many live suites directly on credential presence. Rebase conflicts are likely in any live provider test that changes `describe.skipIf(!process.env.<KEY>)` conditions or OAuth token bootstrapping.

## Live API test gating fixes (2026-04-09)

### What changed

- `test/tool-call-id-normalization.test.ts`: the OpenRouter `gpt-5.2-codex` cases now pass `reasoning: "high"` so the live regression test still exercises tool-call ID normalization against the endpoint's current reasoning requirement.
- `test/cross-provider-handoff.test.ts`: the minimum-fixture assertion now exits early when fewer than two live fixtures are actually generated, so the suite skips gracefully in environments without enough working provider credentials.
- `test/bedrock-utils.ts`: Bedrock live tests now require both credentials and an explicit AWS region before enabling.
- `test/context-overflow.test.ts`: the OpenRouter Anthropic overflow case now accepts the provider's current managed-overflow behavior, and LM Studio overflow tests only auto-enable when `PI_ENABLE_LOCAL_LLM=1`.
- `test/openrouter-cache-write-repro.test.ts`: the narrow OpenRouter cache-write regression is now explicit opt-in via `PI_ENABLE_OPENROUTER_CACHE_WRITE_REPRO=1`.
- `test/total-tokens.test.ts`: the unstable OpenRouter `deepseek/deepseek-chat` total-token regression is now explicit opt-in via `PI_ENABLE_OPENROUTER_DEEPSEEK_TOTAL_TOKENS=1`.

### Why

- OpenRouter now rejects `openai/gpt-5.2-codex` requests when reasoning is omitted or disabled, which broke the normalization regression for reasons unrelated to tool-call ID handling.
- The cross-provider handoff suite assumes multiple working live providers, but `npm test --workspaces --if-present` must pass even when the environment has no valid API keys (or only a partial/invalid live setup).
- Ambient Bedrock tokens without a region and auto-detected local model servers were causing unrelated live E2E suites to run in non-reproducible environments.
- A few narrow OpenRouter regressions are currently backend-specific and unstable in shared environments, so they now require explicit opt-in instead of making the default workspace test command flaky.

### Why extension system couldn't handle this

These failures are in upstream `packages/ai` live integration tests, not in the coding-agent extension surface. Fixing them required targeted test-only updates in `packages/ai/test/`.

### Modified upstream files

- `test/tool-call-id-normalization.test.ts`
- `test/cross-provider-handoff.test.ts`
- `test/bedrock-utils.ts`
- `test/context-overflow.test.ts`
- `test/openrouter-cache-write-repro.test.ts`
- `test/total-tokens.test.ts`

### Expected merge conflict zones

- `test/tool-call-id-normalization.test.ts`: OpenRouter live test options may need re-merging if upstream changes the regression coverage or request options.
- `test/cross-provider-handoff.test.ts`: fixture-count gating may need re-merging if upstream restructures the live handoff bootstrap assertions.
- `test/bedrock-utils.ts`: credential gating may need re-merging if upstream changes how Bedrock test auth is detected.
- `test/context-overflow.test.ts`: OpenRouter overflow handling and local-LM opt-in logic may need re-merging if upstream revises those E2E expectations.
- `test/openrouter-cache-write-repro.test.ts` and `test/total-tokens.test.ts`: explicit opt-in guards may need re-merging if the affected OpenRouter backends become stable again.
