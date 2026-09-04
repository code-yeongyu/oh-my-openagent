# model-core - Model Resolution (Core)

**Generated:** 2026-08-24 (f3642fcda; prior 2026-08-10 38d268995)

## OVERVIEW

Harness-neutral model resolution core (`@oh-my-opencode/model-core`). Resolves which model an agent or category should use via a prioritized pipeline: override, category default, user fallback, hardcoded fallback chain, system default. Consumed by `omo-opencode` (Ultimate adapter shims), `delegate-core` (task delegation), `claude-code-compat-core` (Claude Code model normalization), `skills-loader-core` (model sanitization), and `prompts-core` (variant resolution). The `ProviderCache` interface is the dependency-injection seam for connected-provider and model-metadata lookups.

## KEY FILES

| File | Role |
|------|------|
| `model-resolver.ts` | Entry: `resolveModel()`, `resolveModelWithFallback()`, `normalizeFallbackModels()`, `flattenToFallbackModelStrings()` |
| `model-resolution-pipeline.ts` | `resolveModelPipeline()` - 6-step resolution with logging hooks for testing |
| `provider-cache.ts` | `ProviderCache` DI interface: `readConnectedProvidersCache()`, `findProviderModelMetadata()` |
| `model-availability.ts` | `fuzzyMatchModel()` - exact, then exact model-ID, then shortest **substring** match against `availableModels` (not prefix) |
| `agent-model-requirements.ts` | Hardcoded `AGENT_MODEL_REQUIREMENTS` fallback chains (11 agents) |
| `category-model-requirements.ts` | Hardcoded `CATEGORY_MODEL_REQUIREMENTS` fallback chains (8 categories) |
| `provider-model-id-transform.ts` | Provider-specific ID transforms (Vercel sub-provider inference, Claude version dots, Gemini preview suffixes) |
| `model-capabilities/index.ts` | `getModelCapabilities()` - 4-source priority: runtime metadata -> runtime snapshot -> bundled snapshot -> heuristic family; alias canonicalization, suffix/prefix-tolerant lookup candidates, `resolutionMode` diagnostics |
| `model-capability-heuristics.ts` | `HEURISTIC_MODEL_FAMILY_REGISTRY` + `detectHeuristicModelFamily()` - pattern-based family detection when no snapshot entry exists |
| `model-settings-compatibility.ts` | `resolveCompatibleModelSettings()` - clamps variant/reasoningEffort/temperature/topP/maxTokens/thinking against family + metadata caps, with change reasons |
| `model-capability-aliases.ts` | `resolveModelIDAlias(modelID, providerID?)` canonicalizes exact + pattern aliases; OpenAI GPT-5.6 fast service-tier alias scoped to `openai` and the `vercel` subprovider |
| `model-family-detectors.ts` | Family predicates (`isGptModel`, `isClaudeOpus47OrLaterModel`, `isClaudeFableOrMythosModel`, `isKimiK3Model`, `isGeminiModel`, ...) |
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
- **40 source files** (73 TS incl. co-located tests). Barrel `index.ts` re-exports ~27 public modules. Tests co-located as `*.test.ts`.
- **Capability lookup is suffix-tolerant.** Each model ID expands to up to 4 candidate forms (full, provider-prefix-stripped, variant-suffix-stripped, both), tried most-specific first, so `:high` / `(high)` requests still hit a provider's bare model entry.
- **Snapshot lookup prefers provider-specific keys.** `anthropic/claude-opus-4.8` wins over a bare `claude-opus-4.8` entry when both exist.
- **Metadata beats family caps.** In `resolveCompatibleModelSettings()`, family `reasoningEffortAliases` are applied first, then explicit `capabilities.*` metadata, then heuristic family caps; an unknown family drops the value with `unknown-model-family`.
- **Deprecated routing is tested contract:** deprecated Haiku / GPT-nano entries must NOT route through the `opencode` provider (`model-requirements-deprecated-routing.test.ts`).
- **Error classification is specific by design:** provider "forbidden" (retryable) is distinguished from unrelated filesystem/access "forbidden"; do not broaden substring matching in `model-error-classifier.ts`.
- Parent: [`packages/AGENTS.md`](../AGENTS.md)
