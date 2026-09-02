# Root cause - #6813 OpenAI-only registry recommendations never applied

## Where the maintained recommendations live and who applies them

The OpenAI-only recommendation catalog exists at
`packages/omo-opencode/src/cli/openai-only-model-catalog.ts` (symbols
`applyOpenAiOnlyModelCatalog` and `isOpenAiOnlyAvailability`). Its ONLY consumer is the OpenCode CLI
installer's config generation in `packages/omo-opencode/src/cli/model-fallback.ts`. Nothing in the OMO
Native (senpi) runtime path imports or recomputes it.

## What OMO Native does instead

At task spawn time `packages/senpi-task/src/category/resolver.ts` (`resolveCategory`)
resolves categories against omo.json plus the live senpi model registry, evaluating only the static
generic chains in `packages/senpi-task/src/category/fallback-chains.ts`:

- `artistry`: anthropic/kimi rungs only, no openai rung -> with an OpenAI-only registry
  every rung is unresolvable, so the dead-chain short-circuit (resolver.ts line ~348) returns
  `model_unavailable`. Unavailable, exactly as reported.
- `writing`: kimi/anthropic/google rungs -> same dead-chain outcome. Unavailable.
- `quick`: no direct `openai` rung (the luna-fast rung targets `openai-codex`) ->
  dead-chain. Unavailable.
- `visual-engineering`: its fourth rung DOES list `openai/gpt-5.6-sol`, but with the
  generic `medium` variant, so it resolves Sol at medium instead of the maintained `high`.

Agent resolution (`packages/senpi-task/src/agents/resolve-agent.ts`) evaluates
`packages/senpi-task/src/agents/builtin/fallback-chains.ts`; explore/librarian happen to carry an
`openai/gpt-5.6-luna-fast low` head rung, but a provider alias registered with senpi's explicit
`upstreamModelId` mapping can never match a chain rung keyed on provider id `openai`.

Contributing context from the issue (not edited by this fix):
`packages/omo-native/bin/lib/setup-detect.js` records provider presence from models.json rather than
runtime availability, and `packages/omo-senpi/src/components/task/event-bridge.ts` captures the
auth-filtered registry at session_start. Spawn-time planning
(`packages/omo-senpi/src/components/task/planner.ts`) is the first safe point holding BOTH user
config and live inventory, which is why the overlay compiles inside the senpi-task resolution seam
that planner consumes.

## Fix shape

1. Harness-neutral data module `packages/delegate-core/src/openai-only-recommendations.ts` mirrors
   the maintained catalog (delegate-core is already consumed by both editions).
2. `SenpiModelRegistryPort` gains optional `getUpstreamModelId(model)` so an explicitly mapped
   provider alias can be identified safely; wire-protocol compatibility alone never implies OpenAI
   identity.
3. `packages/senpi-task/src/category/openai-only-overlay.ts` compiles the overlay from the live
   registry: applies only with no explicit user entry, a safely OpenAI-only inventory, and the exact
   recommended model present.
4. `resolver.ts` injects the compiled recommendation ahead of static-chain evaluation (bypassing the
   dead-chain short-circuit); `resolve-agent.ts` does the same for curated agents when the definition
   carries no explicit model choice. User entries always win; nothing rewrites user config files;
   `architect` stays governed by its required-model gate.
