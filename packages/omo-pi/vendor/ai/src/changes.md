# AI Source Changes

## 2026-07-02 - Upstream provider metadata and Codex SSE transport sync

### What changed and why

- `api/openai-codex-responses.ts`: accepted upstream zstd request-body compression for Codex Responses SSE while
  preserving the fork's senpi-branded Codex headers, stale response handling, service-tier support, and thinking support.
- `utils/oauth/device-code.ts` and `utils/oauth/github-copilot.ts`: accepted delayed GitHub Copilot device-code polling
  and related OAuth cleanup.
- Provider model catalogs were refreshed for Copilot, Fireworks, OpenCode, Cloudflare AI Gateway, Bedrock, and related
  providers while retaining fork-specific model capability metadata such as `supportsXhigh`.

### Files modified

- `api/openai-codex-responses.ts`
- `providers/amazon-bedrock.models.ts`
- `providers/cloudflare-ai-gateway.models.ts`
- `providers/fireworks.models.ts`
- `providers/github-copilot.models.ts`
- `providers/opencode-go.models.ts`
- `providers/opencode.models.ts`
- `utils/oauth/device-code.ts`
- `utils/oauth/github-copilot.ts`

### Why the higher-level extension system couldn't handle this alone

- Codex SSE request compression, OAuth polling, and generated provider metadata all live inside `pi-ai` before
  coding-agent extensions can intercept a request or model catalog entry.

### Expected merge conflict zones

- MEDIUM: `api/openai-codex-responses.ts` around request body creation, zstd encoding, headers, and stream response
  handling.
- LOW: `utils/oauth/device-code.ts` around polling cadence and error handling.
- LOW: provider `*.models.ts` catalogs when upstream regenerates model metadata.

## 2026-05-19 - Cloudflare Anthropic computer tool guard

### What changed and why
- `providers/anthropic.ts`: Cloudflare Anthropic routes now strip hook-injected native `computer_*` tools after `onPayload`, while preserving supported native tools such as `bash_20250124` and `text_editor_20250124`.
- Computer-use beta request headers are removed only for routes/models that reject the native computer tool.
- Added a regression matching the CF runtime error where `computer_20250124` is not one of the accepted tool tags.

### Files modified
- `providers/anthropic.ts`
- `../test/anthropic-on-payload-headers.test.ts`

### Why the higher-level extension system couldn't handle this alone
- The failing payload can be introduced by `before_provider_request`; the provider adapter is the final point that sees the complete Anthropic request before SDK submission.

### Expected merge conflict zones
- LOW: native-tool sanitization helpers near request metadata extraction.

## 2026-05-18 - Anthropic protected thinking replay

### What changed and why
- `providers/anthropic.ts`: signed Anthropic `thinking` replay now forwards the stored text exactly as-is instead of running it through local surrogate sanitization. Anthropic treats signed and redacted thinking blocks as protected replay state; rewriting them can make the next tool-result request fail with `thinking` / `redacted_thinking` modification errors.
- `providers/transform-messages.ts`: same-model preserved provider-state blocks are now copied rather than shared, and redacted thinking remains same-model only. Cross-model transforms still drop opaque redacted thinking state.
- Added regressions for signed thinking replay, redacted thinking replay, immutable same-model transforms, cross-model redacted thinking dropping, and retry context behavior after a failed assistant turn.

### Files modified
- `providers/anthropic.ts`
- `providers/transform-messages.ts`
- `../test/anthropic-thinking-disable.test.ts`
- `../test/transform-messages-copilot-openai-to-anthropic.test.ts`
- `../../coding-agent/test/suite/regressions/0000-anthropic-partial-thinking-replay.test.ts`

### Why the higher-level extension system couldn't handle this alone
- Anthropic protected thinking is serialized inside `pi-ai`'s provider adapter after history transformation. Extensions and coding-agent retry logic cannot safely repair a signed block once the provider has normalized or shared it.

### Expected merge conflict zones
- LOW: `convertMessages()` signed/redacted thinking block serialization in `providers/anthropic.ts`.
- LOW: same-model `preserveProviderState` branches in `providers/transform-messages.ts`.

## 2026-05-15 - OpenAI Responses `web_search_preview` compat guard

### What changed and why
- `providers/openai-responses.ts`: after `onPayload` hooks run, custom OpenAI Responses endpoints now strip native `web_search_preview` / `web_search_preview_2025_03_11` tools, the matching `tool_choice`, and `web_search_call.action.sources` includes unless `compat.supportsWebSearchPreview` explicitly opts in. Official `api.openai.com` endpoints keep the existing default support.
- `types.ts`: added `OpenAIResponsesCompat.supportsWebSearchPreview` so custom providers can declare support when they really pass OpenAI-native Responses tools through.
- Added regression coverage for hook-injected native web search on a custom Responses endpoint and the explicit opt-in path.

### Files modified
- `providers/openai-responses.ts`
- `types.ts`
- `../test/openai-responses-web-search-compat.test.ts`

### Why the higher-level extension system couldn't handle this alone
- External or user extensions can add provider-native tools through `before_provider_request`; the final OpenAI Responses payload is only known after all hooks have run. The provider is the last reliable guard before SDK submission.

### Expected merge conflict zones
- LOW: `streamOpenAIResponses()` request construction immediately after the `onPayload` callback.
- LOW: `OpenAIResponsesCompat` if upstream adds more Responses compatibility flags.

## 2026-05-15 - Opus 4.6/4.7 unsupported native computer tool guard

### What changed and why
- `providers/anthropic.ts`: after `onPayload` hooks run, Opus 4.6 and 4.7 requests now strip Anthropic's legacy native `computer_20250124` tool and remove `computer-use-2025-01-24` from hook-added `anthropic-beta` request headers.
- Added a regression to cover extension-style payload mutation where a native computer tool is injected alongside another supported native tool. The supported tool and remaining beta header survive; the Opus-rejected computer tool does not reach the SDK request body.

### Files modified
- `providers/anthropic.ts`
- `../test/anthropic-on-payload-headers.test.ts`

### Why the higher-level extension system couldn't handle this alone
- External or user extensions can add provider-native tools through `before_provider_request`; the final provider payload is only known after all hooks have run. The Anthropic provider is the last reliable guard before SDK submission.

### Expected merge conflict zones
- LOW: `streamAnthropic()` request construction immediately after the `onPayload` callback.
- LOW: native-tool sanitization helpers near request metadata extraction.

## 2026-05-15 - Anthropic `onPayload` request headers

### What changed and why
- `providers/anthropic.ts`: when an `onPayload` hook returns request metadata fields (`headers` / `extra_body`), the provider now forwards string-valued `headers` through the Anthropic SDK request options and strips both metadata keys from the JSON request body.
- Added a regression test for native computer-use extensions that inject `computer_20250124` plus `anthropic-beta: computer-use-2025-01-24` from `before_provider_request`. Previously the tool reached Anthropic but the beta header did not, producing a 400 where `computer_20250124` was not among the accepted tool tags.

### Files modified
- `providers/anthropic.ts`
- `../test/anthropic-on-payload-headers.test.ts`

### Why the higher-level extension system couldn't handle this alone
- Extensions can mutate the provider payload via `before_provider_request`, but Anthropic SDK request headers are assembled inside `pi-ai`. The provider must explicitly lift hook-added header metadata into SDK request options after `onPayload` runs.

### Expected merge conflict zones
- LOW: `streamAnthropic()` request construction around the `onPayload` callback and SDK `messages.create()` options.

## 2026-05-11 - Senpi-branded Codex originator and User-Agent

### What changed and why
- `providers/openai-codex-responses.ts` `buildBaseCodexHeaders()`: changed the hardcoded `originator: "pi"` and the `User-Agent: "pi (…)"` string to `"senpi"`. Upstream chose `"pi"` as the Codex CLI identity; this fork's identity is `senpi`.
- `utils/oauth/openai-codex.ts` `createAuthorizationFlow()`: changed the default `originator` parameter from `"pi"` to `"senpi"` and updated the JSDoc on `loginOpenAICodex` accordingly. Callers can still pass their own originator.

### Files modified
- `providers/openai-codex-responses.ts`
- `utils/oauth/openai-codex.ts`

### Why the higher-level extension system couldn't handle this alone
- The originator + User-Agent headers are built inside `pi-ai`'s Codex header constructor before the request leaves the library. Coding-agent extensions cannot intercept the header construction step.

### Expected merge conflict zones
- LOW: `buildBaseCodexHeaders()` body (3 lines) and the `originator` default parameter / JSDoc in `createAuthorizationFlow`.

## 2026-05-07 - Shared tool pair repair utility for compaction-safe histories

### What changed and why
- Added `utils/tool-pair-repair.ts` to centralize bidirectional `tool_use`/`tool_result` pairing repair in `pi-ai`.
- This supports both coding-agent builtin extensions and external `pi-ai` consumers that do not load coding-agent extensions.

### Files modified
- `utils/tool-pair-repair.ts`

### Why the higher-level extension system couldn't handle this alone
- Extension code alone is not available to standalone `pi-ai` consumers, so this shared history repair logic must live in `pi-ai`.

### Expected merge conflict zones
- None expected; this is a new additive utility file.

## 2026-04-13 - OpenAI Responses custom tool support for apply_patch

### What changed and why
- Added optional freeform grammar metadata to tool types.
- Updated OpenAI Responses request/history conversion to emit and preserve `custom` / `custom_tool_call` / `custom_tool_call_output` items for freeform tools. This was required to match Codex GPT `apply_patch` behavior instead of falling back to JSON function tools.

### Files modified
- `types.ts`
- `providers/openai-responses-shared.ts`

### Why the higher-level extension system couldn't handle this alone
- `pi-ai` only serialized tools as JSON function definitions for OpenAI Responses, so a builtin extension could not produce Codex-compatible freeform tools without core provider changes.

### Expected merge conflict zones
- `types.ts` tool model
- `providers/openai-responses-shared.ts` request/stream conversion paths

## 2026-04-17 - Claude Opus 4.7, `max` effort alignment, and extra-body pass-through

### What changed and why
- Added `claude-opus-4-7` to the Anthropic provider and its Bedrock cross-region profiles (`anthropic.*`, `us.*`, `eu.*`, `global.*`) so Opus 4.7 is available in the catalog and survives re-runs of `generate-models.ts`.
- Expanded `supportsXhigh()` to include `opus-4-7` / `opus-4.7` so the coding agent exposes `xhigh` for Opus 4.7 users.
- Expanded Anthropic adaptive thinking support (`supportsAdaptiveThinking`) and effort mapping (`mapThinkingLevelToEffort`) for Opus 4.7:
  - `xhigh` now maps to the native `"xhigh"` effort on Opus 4.7 (Anthropic's newest tier).
  - `xhigh` still maps to `"max"` on Opus 4.6 (Opus 4.6 doesn't support native `xhigh`).
  - Added explicit `"max"` to the effort type union for future use.
  - Cast through `{ output_config?: { effort: AnthropicEffort } }` while the @anthropic-ai/sdk upstream types still reject `"xhigh"`.
- Added `StreamOptions.extraBody` for pass-through custom body fields (matches opencode's provider `options`). Wired it through every builtin provider's payload builder (`anthropic`, `openai-responses`, `openai-completions`, `azure-openai-responses`, `openai-codex-responses`, `mistral`, `google`, `google-vertex`, `google-gemini-cli`, `amazon-bedrock`). A shared `applyExtraBody` helper and per-provider reserved-key sets live in `providers/simple-options.ts` to prevent users from overriding provider-managed fields (model id, messages, stream flag, etc.).

### Files modified
- `types.ts`
- `models.ts`
- `models.generated.ts`
- `providers/simple-options.ts`
- `providers/anthropic.ts`
- `providers/openai-responses.ts`
- `providers/openai-completions.ts`
- `providers/azure-openai-responses.ts`
- `providers/openai-codex-responses.ts`
- `providers/mistral.ts`
- `providers/google.ts`
- `providers/google-vertex.ts`
- `providers/google-gemini-cli.ts`
- `providers/amazon-bedrock.ts`
- `scripts/generate-models.ts`

### Why the higher-level extension system couldn't handle this alone
- Extra-body pass-through has to be read inside each provider's payload builder (pre-`onPayload` hook), which is core `pi-ai` territory; a coding-agent extension cannot reach into `pi-ai` provider payload construction.
- Opus 4.7 model metadata, xhigh capability detection, and adaptive thinking effort mapping all live in `pi-ai`. `supportsXhigh`, `supportsAdaptiveThinking`, and `mapThinkingLevelToEffort` are internal to the provider.
- Running `generate-models.ts` regenerates `models.generated.ts` from models.dev; the Opus 4.7 override block ensures the upstream regeneration keeps our entry.

### Expected merge conflict zones
- `scripts/generate-models.ts` Opus override block (lines around the 4.6 additions).
- `src/providers/anthropic.ts` `supportsAdaptiveThinking` / `mapThinkingLevelToEffort` / `AnthropicEffort`.
- `src/providers/simple-options.ts` (new exports).
- `src/models.ts` `supportsXhigh`.
- `src/types.ts` `StreamOptions.extraBody`.

## 2026-04-17 (follow-up) - "max" ThinkingLevel + tightened extraBody guards + Google `config` merge

### What changed and why
- Exposed Anthropic's native `"max"` effort through the unified `ThinkingLevel` surface: `StreamOptions.reasoning: "max"` maps to `max` on Opus 4.6/4.7, clamps to `high` on other adaptive models, and falls back to the `high` budget on budget-based Anthropic models. OpenAI-style providers clamp `max` to `xhigh` on xhigh-capable models (GPT-5.2/5.3/5.4) and to `high` otherwise via a new `clampMaxForOpenAI` helper.
- Extended the per-provider reserved-key sets so `extraBody` cannot stomp library-managed fields. New reservations include `metadata`, `temperature`, `store`, `stream_options`, `provider`, `providerOptions`, `tool_stream`, `prompt_cache_key`, `prompt_cache_retention`, `service_tier`, `promptMode`, `requestMetadata`. The Google reserved set now targets the inner `config` object (which the @google/genai SDK serializes as the HTTP request body) with `systemInstruction` / `tools` / `toolConfig` / `generationConfig` / `thinkingConfig` / `responseMimeType` / `responseSchema` / `cachedContent` / `abortSignal` / `httpOptions` reserved.
- Merged Google and Google Vertex `extraBody` into `params.config` instead of the top-level `GenerateContentParameters` so user-supplied fields actually reach the Gemini wire (the SDK does not serialize root-level unknown fields).
- Updated `adjustMaxTokensForThinking` / `clampReasoning` to accept the new `"max"` level without crashing on missing budget entries.

### Files modified (follow-up)
- `src/types.ts` (ThinkingLevel adds `"max"`)
- `src/providers/simple-options.ts` (added `clampMaxForOpenAI`, tightened reserved sets, Google reservations target `config`)
- `src/providers/anthropic.ts` (`mapThinkingLevelToEffort` native `max` case, JSDoc refresh, reserved keys `metadata` + `temperature`)
- `src/providers/openai-responses.ts`, `openai-completions.ts`, `openai-codex-responses.ts`, `azure-openai-responses.ts` (use `clampMaxForOpenAI` on xhigh-capable models)
- `src/providers/amazon-bedrock.ts` (budget table adds `max`, clamp `max` on budget-based path)
- `src/providers/google.ts`, `google-vertex.ts` (merge extraBody into `config`)

### Why the higher-level extension system couldn't handle this alone
- The `ThinkingLevel` union, provider effort mapping, and reserved-key sets all live inside `pi-ai`. Exposing `"max"` to the coding agent requires widening the shared union and updating every provider's payload builder and option-derivation logic.

### Expected merge conflict zones (follow-up)
- `src/types.ts` `ThinkingLevel` union.
- Each provider's `streamSimple<Provider>` reasoning mapping block.
- `src/providers/simple-options.ts` exported reserved-key sets.
