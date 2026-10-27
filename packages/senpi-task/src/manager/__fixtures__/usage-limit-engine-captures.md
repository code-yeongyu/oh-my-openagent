# Usage-limit engine captures

These are complete assistant messages returned by the published engine's
dist/api/openai-codex-responses.js stream(...).result(), not invented diagnostic
objects. The transport is a synthetic HTTP 429, with no network or credentials.

- usage-limit-original-engine.json: @code-yeongyu/senpi-ai 2026.10.19-2,
  the pin at PR head 49f56140217eb519649f4cc0a120612c6c598a00.
  The actual message has no providerDiagnostic and therefore no structured reset.
- usage-limit-pinned-engine.json: @code-yeongyu/senpi-ai 2026.10.25-2,
  the pin after merging dev. providerDiagnostic.resetsAt is epoch milliseconds,
  not an ISO string. The provider's resets_at input is epoch seconds.

Capture inputs: Date.now = 1793010000000, transport = sse, maxRetries = 0,
apiKey = synthetic-noncredential. The fetch option returns HTTP 429 JSON:

```json
{"error":{"type":"usage_limit_reached","plan_type":"pro","resets_at":1793059200}}
```

Model: gpt-6-astra, provider chatgpt-subscription, API openai-codex-responses,
baseUrl https://provider.invalid, reasoning true, input text, zero costs,
contextWindow 200000, maxTokens 4096. Context: messages [].

The new diagnostic contract and adapter implementation are in the published
dist/provider-diagnostic.d.ts and
dist/api/openai-codex-responses/provider-diagnostic.js. Structured reset propagation
is already shipped by the new pin; no unreleased engine API is assumed.
