# packages/ai

`@earendil-works/pi-ai` — unified streaming + tool-calling API across 15+ LLM providers. Browser-safe (subset). Used by every other package in the monorepo.

## STRUCTURE

```
src/
├── types.ts                       # Api, Model, Message, StreamOptions, KnownProvider, ToolDef
├── stream.ts                      # AssistantMessageEventStream + helpers
├── api-registry.ts                # registerApiProvider() / lazy provider lookup
├── images-api-registry.ts         # registerImagesApiProvider() (image-gen providers)
├── images.ts / image-models.ts    # Image-generation surface
├── env-api-keys.ts                # Credential autodetect — INLINE imports only
├── oauth.ts                       # Generic OAuth helpers
├── session-resources.ts           # Per-stream temp resources (cleanup hooks)
├── bedrock-provider.ts            # Bedrock-specific subpath export
├── cli.ts                         # `pi-ai` debug binary
├── models.ts / models.generated.ts          # Model catalog (generated; do NOT hand-edit)
├── image-models.ts / image-models.generated.ts  # Image-model catalog (generated)
├── providers/                     # See packages/ai/src/providers/AGENTS.md
├── tool-call-middleware/          # XML/Hermes/YAML+XML text-tool protocols
└── utils/                         # diagnostics, hash, validation, oauth/, tool-pair-repair…

scripts/
├── generate-models.ts             # Pulls latest catalog → models.generated.ts
└── generate-image-models.ts       # Same for image-models.generated.ts

test/                              # ~80 vitest files; opt-in live API gating via env vars
```

## WHERE TO LOOK

| Task | File(s) | Notes |
|------|---------|-------|
| Add LLM provider | `src/providers/AGENTS.md` | 7-step checklist there |
| Add provider OAuth | `src/utils/oauth/<provider>.ts` + `src/oauth.ts` | Inline-import the dynamic bits |
| Edit model catalog | `scripts/generate-models.ts` | Regenerate via `npm run generate-models` |
| Cross-provider message conversion | `src/providers/transform-messages.ts` | One-shot mapper between role/content shapes |
| SimpleStreamOptions ↔ provider opts | `src/providers/simple-options.ts` | Per-provider effort/reasoning translation |
| Mock provider (tests) | `src/providers/faux.ts` | `registerFauxProvider()`, `fauxAssistantMessage()` |
| Text-format tool calls (Hermes/XML) | `src/tool-call-middleware/` | Wraps providers that don't natively call tools |
| Browser-safe credential probe | `src/env-api-keys.ts` | Inline `await import()` only |

## CONVENTIONS

- **Lazy providers**: every entry in `providers/register-builtins.ts` is a `() => import("./<provider>.js")` arrow. Static imports there are forbidden — they bloat browser bundles and break Vite consumers.
- **Subpath exports**: each public provider is exported under its own `./<provider>` subpath in `package.json` (`./anthropic`, `./google`, `./openai-responses`, …). New providers MUST be added there too.
- **Stream entry shape**: every provider exports `stream<Provider>(opts: StreamOptions): AssistantMessageEventStream`. Keep the name pattern.
- **Live test gating**: `describe.skipIf(!process.env.<API_KEY>)` for any test that calls a real endpoint. Add `{ retry: 3 }` for flaky public APIs. Add an explicit `PI_ENABLE_…=1` opt-in for unstable provider regressions (precedent: OpenRouter cache-write repro).
- **Generated files committed**: `models.generated.ts` and `image-models.generated.ts` ARE checked in (consumers that only build still get a working catalog). Ordinary builds must not regenerate them; regenerate before publishing or for intentional catalog updates.
- **Browser smoke**: `scripts/check-browser-smoke.mjs` (root) bundles `src/index.ts` for the browser and verifies no Node-only imports leak.

## ANTI-PATTERNS

- **Static imports in `providers/register-builtins.ts`** — breaks lazy loading and balloons browser bundles.
- **Top-level imports in `env-api-keys.ts` or `utils/oauth/*`** — breaks browser builds; the comment in `env-api-keys.ts` is load-bearing.
- **Hand-editing `*.generated.ts`** — regenerate via the scripts.
- **Real API keys in unit tests** — use `faux` provider; tests must pass with zero credentials in `npm test`.
- **Guessing external SDK types** — read `node_modules/@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/*` directly when wiring a provider.

## NOTES

- `models.generated.ts` and `image-models.generated.ts` should only show up as modified after explicit generation or publish prep. Commit only intentional regenerations.
- The `bedrock-provider` subpath export exists separately so non-AWS consumers can avoid the AWS SDK transitive cost.
- `tool-call-middleware/TESTING.md` documents how to add a new text-tool protocol without breaking stream-error recovery.
