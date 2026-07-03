# packages/ai/src/providers

Per-provider streaming + tool-call adapters. Lazy-loaded. Each file exports `stream<Provider>()` returning an `AssistantMessageEventStream`.

## FILE LAYOUT

```
providers/
├── register-builtins.ts        # Lazy `() => import("./<provider>.js")` wrappers — STATIC IMPORTS FORBIDDEN
├── transform-messages.ts       # Cross-provider Message ↔ provider-format mapper (single source)
├── simple-options.ts           # SimpleStreamOptions ↔ provider-specific opts (effort, reasoning, tools)
├── faux.ts                     # Mock provider for tests; `registerFauxProvider()` + `fauxAssistantMessage()`
├── anthropic.ts                # Anthropic Claude — direct API
├── amazon-bedrock.ts           # AWS Bedrock (uses bedrock-provider.ts shim for cross-region profiles)
├── google.ts                   # Google Gemini direct API
├── google-vertex.ts            # Vertex AI variant
├── google-shared.ts            # Helpers shared by google.ts + google-vertex.ts
├── mistral.ts                  # Mistral
├── cloudflare.ts               # Cloudflare base-URL helpers (isCloudflareProvider/resolveCloudflareBaseUrl) — NOT a provider; used by openai-completions/openai-responses/anthropic
├── openai-completions.ts       # OpenAI Completions API + clones (Groq, Together, OpenRouter, Fireworks, …)
├── openai-responses.ts         # OpenAI Responses API
├── openai-responses-shared.ts  # Helpers shared between openai-responses.ts + openai-codex-responses.ts
├── openai-codex-responses.ts   # Codex (apply_patch / freeform tool grammar)
├── azure-openai-responses.ts   # Azure OpenAI Responses API variant
├── github-copilot-headers.ts   # Headers + auth for Copilot routing
└── images/                     # Image-generation providers (currently OpenRouter only)
```

## ADD A PROVIDER (7-step canonical checklist)

1. Create `providers/<name>.ts` exporting `stream<Name>(opts: StreamOptions): AssistantMessageEventStream`.
2. Register in `providers/register-builtins.ts` as a **lazy** Promise wrapper. NEVER static-import.
3. Add subpath export to `packages/ai/package.json` `exports["./<name>"]`.
4. Add provider-specific options translation in `simple-options.ts` (effort, reasoning, tools).
5. Add message-format adapters to `transform-messages.ts` if the wire shape differs.
6. Add models to `scripts/generate-models.ts`; run `npm run generate-models`. Commit `models.generated.ts`.
7. Write tests: `test/<name>.test.ts` (gated by `describe.skipIf(!process.env.<KEY>)` + `{ retry: 3 }` for live).

## CONVENTIONS

- **Provider files are self-contained**. Shared helpers live in `*-shared.ts` (`google-shared.ts`, `openai-responses-shared.ts`); add a new shared module when 3+ providers duplicate logic.
- **Tools**: `simple-options.ts` is the canonical place to map `StreamOptions.tools` into provider-native tool definitions.
- **`extraBody`**: every provider must thread `StreamOptions.extraBody` into the wire payload (precedent: 2026-04-17 in `src/changes.md`).
- **OAuth providers** (Anthropic, OpenAI Codex, GitHub Copilot, Google Vertex): credential refresh lives in `src/utils/oauth/<provider>.ts`. Token resolution must use INLINE imports (`await import(...)`) for browser compat.
- **Faux provider** is part of the public surface for tests. Update `faux.ts` whenever adding new event types to `AssistantMessageEventStream`.

## ANTI-PATTERNS

- `import { stream<X> } from "./<x>.js"` at the top of `register-builtins.ts` — defeats lazy loading and bloats browser bundles.
- Calling provider SDKs from tests without env-key gating — `npm test` MUST pass with zero credentials.
- Adding hardcoded model lists to provider files — generate via `scripts/generate-models.ts`.
- Mutating shared message objects in `transform-messages.ts` — return new structures.

## NOTES

- Cross-provider `transform-messages.ts` is the canonical spot for image/tool-result/thinking-block coercion. Each new provider that uses a non-standard format adds adapter logic here, not in its own file.
- `openai-completions.ts` is reused by clones (Groq, OpenRouter, Together, Fireworks). Provider-specific kinks live in `openai-completions-*.test.ts`.
- The `images/` subdir is structurally separate from text providers — image-API entry points live in `src/images-api-registry.ts`.
