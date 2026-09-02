# Plan - Fix #6813: OpenAI-only registry recommendations never applied in OMO Native

## Root cause (file:line)

The maintained OpenAI-only recommendation catalog is applied ONLY by the OpenCode CLI installer at
config-generation time:

- `packages/omo-opencode/src/cli/openai-only-model-catalog.ts` (`applyOpenAiOnlyModelCatalog`),
  consumed by `packages/omo-opencode/src/cli/model-fallback.ts`.

OMO Native's runtime resolution path never sees it:

- `packages/senpi-task/src/category/resolver.ts` (`resolveCategory`) evaluates only the static
  generic chains in `packages/senpi-task/src/category/fallback-chains.ts`; with an OpenAI-only live
  registry `artistry` and `writing` have no OpenAI rung, while `quick` has no direct `openai` rung.
  Those categories have zero resolvable static rungs and reach the dead-chain short-circuit;
  `visual-engineering` resolves its generic OpenAI rung at `medium` instead of the
  maintained `high`.
- `packages/senpi-task/src/agents/builtin/fallback-chains.ts` already carries
  `openai/gpt-5.6-luna-fast low` head rung for explore/librarian, but alias-mapped providers
  (explicit `upstreamModelId`) can never match it.
- Contributing context (not edited): `packages/omo-native/bin/lib/setup-detect.js` records provider
  presence from models.json only; `packages/omo-senpi/src/components/task/event-bridge.ts` captures
  the auth-filtered registry at session_start; `planner.ts` spawn time is the first safe point with
  both user config and live inventory.

## Change set

1. NEW `packages/delegate-core/src/openai-only-recommendations.ts`: harness-neutral pure data module
   mirroring the maintained catalog (categories: artistry sol/xhigh, quick luna-fast/default,
   visual-engineering sol/high, writing sol/medium; agents: explore+librarian luna-fast/low;
   architect deliberately absent so its required-model gate stays authoritative). Barrel export in
   `src/index.ts`. Co-located test.
2. `packages/senpi-task/src/category/types.ts`: extend `SenpiModelRegistryPort` with OPTIONAL
   `getUpstreamModelId?: (model: TModel) => unknown` (senpi ModelRegistry has this method;
   structural port stays backward compatible).
3. NEW `packages/senpi-task/src/category/openai-only-overlay.ts`: pure compiler
   `compileOpenAiOnlyOverlay(recommendations, targetName, registry)`:
   - safe-parses `registry.getAvailable()` (own-data-property + secret-like-field guards, same as
     resolver.ts);
   - a model is openai-identified iff `provider === "openai"` OR an explicit upstream mapping
     (`getUpstreamModelId`) equals a known recommended model id; wire-protocol compatibility alone is
     NEVER treated as identity;
   - inventory qualifies only when non-empty and EVERY model is openai-identified;
   - returns `{ recommendation, target: {provider, modelId} }` when the table names the target and
     the exact recommended identity exists (direct `openai/<id>` or explicitly mapped alias).
4. `packages/senpi-task/src/category/resolver.ts`: in `resolveCategory`, when the category has NO
   explicit user entry and the overlay compiles, inject the recommended model as the resolution
   target: bypass the dead-chain short-circuit, resolve against the exact registry entry, overlay
   variant wins over builtin config variant but loses to any user variant. Runtime availability
   listings treat the same active overlay as satisfying chain viability from the same snapshot.
5. `packages/senpi-task/src/agents/resolve-agent.ts`: when the agent definition carries no explicit
   `model`/`models` and the overlay compiles, resolve the recommendation (variant included) before
   chain evaluation.

## Verification

- Failing-first regression tests (RED before step 4/5, GREEN after):
  `packages/senpi-task/src/category/openai-only-overlay.test.ts`,
  `packages/senpi-task/src/agents/openai-only-agent-overlay.test.ts`.
- Scoped suites: `bun test packages/delegate-core packages/senpi-task packages/omo-senpi`.
- Typecheck: tsgo --noEmit for delegate-core, senpi-task, omo-senpi tsconfigs.
- Evidence + captured outputs in this directory.

## Constraints honored

- Explicit user `categories.<name>` / disabled entries always win; user files never rewritten.
- `architect` untouched (required-model gate preserved).
- No type suppression, no weakened tests, no unrelated refactors; runtime listings and spawn-time
  resolution use the same active overlays from one registry snapshot.
