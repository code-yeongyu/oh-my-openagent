# model-core — Model Resolution (Core)

**Generated:** 2026-06-16

## OVERVIEW

Harness-neutral model resolution core (`@oh-my-opencode/model-core`). Resolves which model an agent or category should use via a prioritized pipeline: override, category default, user fallback, hardcoded fallback chain, system default. Consumed by `omo-opencode` (Ultimate adapter shims), `delegate-core` (task delegation), `claude-code-compat-core` (Claude Code model normalization), `skills-loader-core` (model sanitization), and `prompts-core` (variant resolution). The `ProviderCache` interface is the dependency-injection seam for connected-provider and model-metadata lookups.

## KEY FILES

| File | Role |
|------|------|
| `model-resolver.ts` | Entry: `resolveModel()`, `resolveModelWithFallback()`, `normalizeFallbackModels()` |
| `model-resolution-pipeline.ts` | `resolveModelPipeline()` — 6-step resolution with logging hooks for testing |
| `provider-cache.ts` | `ProviderCache` DI interface: `readConnectedProvidersCache()`, `findProviderModelMetadata()` |
| `model-availability.ts` | `fuzzyMatchModel()` — exact, then shortest prefix match against `availableModels` |
| `agent-model-requirements.ts` | Hardcoded `AGENT_MODEL_REQUIREMENTS` fallback chains (11 agents) |
| `category-model-requirements.ts` | Hardcoded `CATEGORY_MODEL_REQUIREMENTS` fallback chains (8 categories) |
| `provider-model-id-transform.ts` | Provider-specific ID transforms (Vercel sub-provider inference, Claude version dots, Gemini preview suffixes) |
| `model-capabilities/index.ts` | Capability queries against bundled snapshot + runtime readers |
| `runtime-fallback-*.ts` | Error classification, auto-retry signals, and runtime fallback model selection |

## FLOW

```
resolveModelPipeline(request, providerCache)
  1. UI-selected model → "override"
  2. User config model → "override"
  3. Category default → fuzzy match availableModels, or connected provider via ProviderCache → "category-default"
  4. User fallback_models → match availableModels or connected providers → "provider-fallback"
  5. Hardcoded fallback chain (agent/category requirements) → cross-provider fuzzy match → "provider-fallback"
  6. systemDefaultModel → "system-default"
```

## NOTES

- **ProviderCache is injected**, not imported. `omo-opencode` implements it with runtime cache state; `model-core` stays pure.
- **Two resolution APIs:** `resolveModel()` for simple 3-tier fallback; `resolveModelWithFallback()` for full pipeline with `ExtendedModelResolutionInput`.
- **`connected-providers-cache.ts`** exports no-op defaults. Adapters override via the `ProviderCache` parameter.
- **59 source files.** Barrel `index.ts` re-exports ~25 public modules. Tests co-located as `*.test.ts`.
- Parent: [`packages/AGENTS.md`](../AGENTS.md)
