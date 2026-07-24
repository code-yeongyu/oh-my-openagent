# delegate-core — Delegate Model Selection + Retry Guidance (Core)

**Generated:** 2026-07-17 / 7d664b96b

## OVERVIEW

Three harness-neutral primitives for the `task`/delegate tool: model resolution, corrective retry guidance, and spawn admission. All are pure functions with zero state or IO and injected inputs. Package: `@oh-my-opencode/delegate-core`.

## PUBLIC API (`src/index.ts` barrel)

| Module | Key exports |
|--------|-------------|
| `model-selection.ts` | `resolveModelForDelegateTask(input, deps)`; types `DelegateFallbackEntry`, `DelegateModelResolutionInput/Result/Deps` |
| `retry-patterns.ts` | `detectDelegateTaskError(output)`, `DELEGATE_TASK_ERROR_PATTERNS` (9 entries) |
| `retry-guidance.ts` | `buildRetryGuidance(errorInfo)` — fix hint + available options + example call |
| `spawn-policy.ts` | `decideSpawnAdmission(input)` — role, lineage, target allowlist, and depth enforcement with immutable depth ceiling `2` |

### Resolution order (`resolveModelForDelegateTask`)

1. user model override (promote first reachable `userFallbackModels` if unreachable) → 2. **skip sentinel** if caches cold (`{skipped: true}`) → 3. category default model (user-set returned as-is, else fuzzy-matched) → 4. user `fallback_models` array → 5. hardcoded `fallbackChain` (per-entry providers, exact-then-fuzzy) → 6. system default → 7. `undefined`.

### Recognized error patterns (9)

`missing_run_in_background`, `missing_load_skills`, `mutual_exclusion`, `missing_category_or_agent`, `unknown_category`, `empty_agent`, `unknown_agent`, `primary_agent`, `unknown_skills`.

### Spawn admission

Spawn admission defaults to depth `1`, fails closed for unknown or cyclic lineage, and limits effective depth to the minimum of configured depth, caller depth, and immutable ceiling `2`. Target allowlists only narrow access. They never expand role or depth permission.

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/model-core` (`fuzzyMatchModel`, `normalizeModel`, `parseModelString`, `parseVariantFromModelID`, `transformModelForProvider`).
- **Consumed by** (OpenCode edition only; no Codex consumer): `omo-opencode/src/tools/delegate-task/model-selection.ts` (wires cache + logger deps) and `hooks/delegate-task-retry/{patterns,guidance}.ts` (re-export).

## NOTES

- **Cold-cache `skipped` sentinel:** when `availableModels` AND `connectedProviders` caches are both empty, resolution defers — caller waits for the model cache rather than picking wrong.
- **`-high` models** are matched on their base model exactly, never fuzzy-downgraded to a non-high variant.
- **Variant propagation:** a matched `DelegateFallbackEntry`'s variant flows through to the result.
- **Fallback-chain provider shaping:** each entry's model passes through `transformModelForProvider` before exact matching, so provider-prefixed IDs (e.g. Vercel `openai/gpt-5.6-sol`) resolve on the owning entry. Cross-provider fuzzy matching skips providers that have a later dedicated rung for the same model, so an unlisted custom provider keeps the earlier variant instead of being preempted by a later rung.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
