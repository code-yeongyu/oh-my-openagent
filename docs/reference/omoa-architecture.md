# OMOA — Model Management Architecture

## Status

Proposed (PR #4158). Awaiting maintainer review.

## Overview

OMOA (Oh-My-OpenAgent Model Management) adds a **policy-based model routing layer** to Oh-My-OpenAgent. It lets users define model preferences per agent/category as ranked lists (rankings) and control provider availability (state), then resolves and applies the best configuration automatically.

## Problem Statement

Oh-My-OpenAgent's existing model resolution depends on:

1. **Hardcoded fallback chains** in `packages/model-core/src/model-requirements.ts` — compiled into the package, not user-configurable.
2. **Manual overrides** in `oh-my-openagent.json` via `agents.<name>.model` and `fallback_models` — powerful but requires the user to know exact model IDs and provider availability.

As the provider/model landscape grows, users need a way to:

- Express preferences ("I prefer Anthropic models, fall back to OpenAI") without knowing exact model IDs.
- Disable a provider globally (e.g., "OpenAI is down, route everything to Anthropic/Google").
- Preview what model each agent would resolve to before committing.
- Get validation warnings about banned, deprecated, or misconfigured models.

## Data Model

### OmoaState (`omoa-state.json`)

Stored in the opencode config directory (`~/.config/opencode/omoa-state.json`). Records the operational state of providers and model governance.

```typescript
interface OmoaState {
  version: 1;
  providers: Record<string, {
    enabled: boolean;            // Provider globally enabled/disabled
    free_only: boolean;          // Only route to free-tier models
    avoid_fallback_from: string[]; // Don't fall back to these providers
  }>;
  banned_models: string[];       // Models that MUST NOT be used (error if assigned)
  deprecated_models: string[];   // Models that SHOULD NOT be used (warning if assigned)
  active_preset: "balanced" | "emergency-free" | "custom";
}
```

### OmoaRankings (`omoa-rankings.json`)

Stored in the same config directory. Records per-agent and per-category model preference lists.

```typescript
interface OmoaRankings {
  version: 1;
  agents: Record<string, ModelRankingEntry[]>;     // Per-agent ranked lists
  categories: Record<string, ModelRankingEntry[]>; // Per-category ranked lists
  fallback_provider_order: string[];               // Global cross-provider fallback order
}

interface ModelRankingEntry {
  model: string;        // e.g. "openai/gpt-5.5" or "anthropic/claude-opus-4-7"
  variant?: string;     // e.g. "high", "medium", "max"
}
```

### oh-my-openagent.json (output target)

OMOA writes resolved model assignments into the existing `oh-my-openagent.json` file, targeting the same `agents.<name>.model` and `agents.<name>.fallback_models` fields that the model-core resolver already reads.

## Policy DSL

OMOA defines two user-facing policy primitives:

### 1. Rankings (Preference Lists)

A ranked list of models per agent/category. Position = priority.

```jsonc
// omoa-rankings.json
{
  "agents": {
    "sisyphus": [
      { "model": "anthropic/claude-opus-4-7" },
      { "model": "openai/gpt-5.5" },
      { "model": "google/gemini-3.1-pro" }
    ],
    "oracle": [
      { "model": "openai/gpt-5.5" },
      { "model": "google/gemini-3.1-pro" }
    ]
  }
}
```

Rankings encode the user's **preference order**, not a strict chain. The resolver picks the highest-ranked model whose provider is enabled.

### 2. Provider State (Availability)

Controls which providers and models are available for routing.

```jsonc
// omoa-state.json
{
  "providers": {
    "openai": { "enabled": true },
    "anthropic": { "enabled": true },
    "deepseek": { "enabled": false }  // outage or deprioritized
  },
  "banned_models": ["opencode/deprecated-v1"],
  "active_preset": "balanced"
}
```

### Banned vs Deprecated Contract

- `banned_models` are hard exclusions. OMOA will not select them during build, and validation reports existing banned assignments as errors.
- `deprecated_models` are soft exclusions. OMOA avoids selecting them during build, and validation reports existing deprecated assignments as warnings.

## Resolution Algorithm (`resolver.ts`)

For each agent/category with rankings defined:

1. Filter rankings by `isModelAvailable()`:
   - Provider must be enabled.
   - Model must not be banned or deprecated.
   - If provider is `free_only`, model must end with `-free`.
2. Pick the **first available** entry as primary.
3. Pick the **first cross-provider** available entry as fallback:
   - Must be a different provider than primary.
   - Must not be in primary provider's `avoid_fallback_from` list.
4. Return `{ primary, fallback, primaryReason, fallbackReason }`.

This is a **simple ranked-choice** algorithm — not a full constraint solver. It trades generality for predictability.

## Layering: OMOA vs Existing Resolution

### The Five Resolution Layers

The model-core `resolveModelPipeline()` checks sources in this priority order:

| Priority | Source | Layer | Writes To |
|----------|--------|-------|-----------|
| 1 (highest) | `uiSelectedModel` | UI session override | Session only |
| 2 | `userModel` / `userFallbackModels` | **oh-my-openagent.json** ← **OMOA writes here** | Config file |
| 3 | `categoryDefaultModel` | Category defaults | Config file |
| 4 | `userFallbackModels` | Manual fallback_models | Config file |
| 5 | `fallbackChain` | **model-requirements.ts** (hardcoded) | Package code |
| 6 (lowest) | `systemDefaultModel` | System fallback | Config/settings |

### OMOA's Position in the Stack

```
User Manual Config          OMOA Policy
(oh-my-openagent.json)      (omoa-state.json + omoa-rankings.json)
         │                            │
         │                    omoa build (resolver + builder)
         │                            │
         └────────┬───────────────────┘
                  │
        oh-my-openagent.json
        (agents.<name>.model)
                  │
                  ▼
     model-core/resolveModelPipeline()
                  │
                  ▼
            Runtime Model
```

**Key insight**: OMOA does NOT introduce a new config format alongside `oh-my-openagent.json`. It targets the same config file that manual editing targets. The separation is temporal:

- **OMOA-managed fields**: Set by `omoa build`, identifiable at runtime by checking if the agent has rankings defined.
- **Manual fields**: Set directly by the user in oh-my-openagent.json, with no OMOA rankings.

### Conflict Resolution: OMOA vs Manual Editing

| Scenario | What Wins | Why |
|----------|-----------|-----|
| User sets `agents.sisyphus.model` + no OMOA rankings for sisyphus | **Manual config** | `omoa build` only touches agents/categories that have rankings. Manual entries without rankings are left unchanged. |
| User sets `agents.sisyphus.model` + OMOA has rankings for sisyphus | **OMOA on build** | Rankings opt that target into OMOA management. `omoa build --dry-run` previews the change, and non-dry-run writes create a backup first. |
| User sets `agents.sisyphus.model` + user also has chat.params override | **chat.params > config** | Chat params are session-level and checked at a different point in the pipeline. |
| OMOA sets model + model-requirements.ts has fallback chains | **OMOA > hardcoded** | `resolveModelPipeline` checks `userModel` (step 2) before `fallbackChain` (step 5). |

The safety boundary is opt-in by rankings: no ranking means no automatic write for that agent/category.

## Usage Walkthrough

### On-Ramp: Empty Project

```bash
# 1. First run — OMOA reads connected providers from the runtime cache
$ oh-my-opencode omoa

# 2. Status shows all connected providers, no rankings defined yet
$ oh-my-opencode omoa status
  Providers:
    [x] anthropic
    [x] openai
    [ ] deepseek

  Agents:
    sisyphus              [manual]  primary=not set
    oracle                [manual]  primary=not set

# 3. Enable/disable providers
$ oh-my-opencode omoa provider disable deepseek

# 4. Launch interactive TUI to set rankings
$ oh-my-opencode omoa
  → Rankings → sisyphus → add "anthropic/claude-opus-4-7"
  → Rankings → sisyphus → add "openai/gpt-5.5"
  → Assign Model → sisyphus → pick from ranked list

# 5. Build — resolves rankings + state, writes oh-my-openagent.json
$ oh-my-opencode omoa build
  sisyphus [agent] model: (none) -> anthropic/claude-opus-4-7 (rank #1)
  sisyphus [agent] fallback_models: (none) -> openai/gpt-5.5 (rank #2, cross-provider)
  Backup: /home/user/.config/opencode/oh-my-opencode.json.backup-1712345678

# 6. Verify
$ oh-my-opencode omoa status
  sisyphus              [OMOA]   primary=anthropic/claude-opus-4-7  fallback=openai/gpt-5.5
```

### What `omoa build` Produces

Given the above state + rankings, `omoa build` writes to oh-my-openagent.json:

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": ["openai/gpt-5.5"]
    }
  }
}
```

And creates a backup at `oh-my-openagent.json.backup-<timestamp>`.

## Testing Strategy

### Unit Tests (existing in PR)

| File | Coverage |
|------|----------|
| `resolver.test.ts` | 4 test cases: basic resolution, provider disabled, banned models, cross-provider fallback, avoid_fallback_from, free_only, all-unavailable |
| `validator.test.ts` | Validation rules for each warning type |

### CLI Integration Test

A CLI-level test exists at `src/cli/omoa/omoa-cli.test.ts`. It:
1. Writes fixture `omoa-state.json` and `omoa-rankings.json` to a temp config directory.
2. Runs `omoa build`.
3. Asserts the produced `oh-my-openagent.json` matches expected output.
4. Verifies dry-run, backup creation, provider-disabled selection, banned-model skipping, and category assignment.

This locks the user-visible CLI contract rather than only testing resolver internals.

## Future Considerations

### PR #1529 — TUI Config Editor

The interactive TUI config editor (PR #1529) adds a `config` CLI command for schema-driven editing of `oh-my-openagent.json`. This overlaps with OMOA's `omoa edit` and `omoa assign` TUI screens. Both should be unified under a single entry point:

- `omoa config` — edit any field in oh-my-openagent.json (schema-driven, from #1529)
- `omoa build` — OMOA-specific auto-resolution from rankings + state
- `omoa rankings` — manage ranking lists

### Emergency Presets

The `active_preset` field in `OmoaState` is reserved for future emergency-mode routing (e.g., "free_only" when all paid providers fail). Not yet implemented.

### Integration with model-core Snapshot System

OMOA's `model-cache.ts` reads from the same model cache that model-core uses. Future versions could share a typed interface rather than reading raw JSON.

## Non-Goals

- OMOA does NOT replace model-requirements.ts fallback chains. Hardcoded chains remain as a fallback when no OMOA rankings are defined for an agent.
- OMOA does NOT add a new config file format alongside oh-my-openagent.json. State and rankings are internal data files.
- OMOA does NOT implement real-time provider health monitoring. Provider state is user-managed.
