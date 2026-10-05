import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { DEFAULT_CATEGORIES, resolveCategory, type SenpiModelPort, type SenpiModelRegistryPort } from "../category"
import { findExactAgentModel } from "./agent-model-registry"
import type { ResolvedModelRecord } from "../state"

export type AgentCategoryTuning = {
  readonly variant?: string
  readonly reasoningEffort?: string
}

export type AgentCategorySelection = {
  readonly provider: string
  readonly modelId: string
  readonly variant?: string
  readonly reasoningEffort?: string
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
}

export type ResolveAgentCategoryInput<TModel extends SenpiModelPort> = {
  readonly categories: readonly string[]
  readonly omoConfig: OmoConfig
  readonly registry: SenpiModelRegistryPort<TModel>
  readonly configuredTuning: AgentCategoryTuning
}

// `resolveCategory` fails closed when the registry's available-model container is unparseable,
// which would strip categorized agents of the find-only degradation the direct-model path keeps
// ("an unparseable available set keeps the find-only behavior" in resolve-agent.ts). Recover the
// first listed category's model straight from `find` so a junk availability payload cannot make a
// model the registry can serve unreachable. `findExactAgentModel` is the direct-model path's own
// validator: it rejects a registry return that is not actually a model, so a malformed container
// cannot launder an error envelope into a resolved selection.
function findOnlyCategoryModel<TModel extends SenpiModelPort>(
  input: ResolveAgentCategoryInput<TModel>,
): AgentCategorySelection | undefined {
  if (Array.isArray(input.registry.getAvailable())) return undefined
  const fallbackModel = firstCategoryDefaultModel(input.categories, input.omoConfig)
  if (fallbackModel === undefined) return undefined
  const found = findExactAgentModel(fallbackModel, input.registry)
  if (found === undefined) return undefined
  return {
    provider: found.provider,
    modelId: found.modelId,
    ...(input.configuredTuning.variant !== undefined ? { variant: input.configuredTuning.variant } : {}),
    ...(input.configuredTuning.reasoningEffort !== undefined
      ? { reasoningEffort: input.configuredTuning.reasoningEffort }
      : {}),
  }
}

// The model the agent would have run on had a category resolved: the first listed category's
// model. A user `categories.<name>.model` outranks the builtin default so a failure names what the
// user actually configured instead of a builtin they never chose. Feeds `attemptedModel` on the
// model_unavailable and no-registry paths.
export function firstCategoryDefaultModel(
  categories: readonly string[] | undefined,
  omoConfig?: OmoConfig,
): string | undefined {
  const userCategories = omoConfig?.categories
  for (const name of categories ?? []) {
    const userModel = userCategories !== undefined && Object.hasOwn(userCategories, name)
      ? userCategories[name]?.model
      : undefined
    if (userModel !== undefined) return userModel
    const builtin = Object.hasOwn(DEFAULT_CATEGORIES, name) ? DEFAULT_CATEGORIES[name] : undefined
    if (builtin?.model !== undefined) return builtin.model
  }
  return undefined
}

// Categories supply the MODEL only: prompt_append, tools, temperature, top_p, maxTokens and
// thinking from the category config are deliberately dropped so the agent keeps its own persona.
// The first category that resolves wins; every later category that also resolves extends the
// runtime retry chain, so "deep -> unspecified-high" is both a resolve-time and a runtime fallback.
export function resolveAgentCategoryModel<TModel extends SenpiModelPort>(
  input: ResolveAgentCategoryInput<TModel>,
): AgentCategorySelection | undefined {
  const resolutions = input.categories
    .map((name) => resolveCategory(name, input.omoConfig, input.registry))
    .filter((resolution) => resolution.kind === "resolved")
  const winner = resolutions[0]
  if (winner === undefined) return findOnlyCategoryModel(input)

  const { spec } = winner
  const categoryReasoning = spec.reasoning ?? spec.reasoningEffort ?? spec.variant
  const chain = agentModelChain(resolutions.map((resolution) => resolution.spec))

  return {
    provider: spec.provider,
    modelId: spec.modelId,
    ...(input.configuredTuning.variant !== undefined
      ? { variant: input.configuredTuning.variant }
      : categoryReasoning !== undefined ? { variant: categoryReasoning } : {}),
    ...(input.configuredTuning.reasoningEffort !== undefined
      ? { reasoningEffort: input.configuredTuning.reasoningEffort }
      : {}),
    ...chain,
  }
}

type CategorySpecChain = {
  readonly provider: string
  readonly modelId: string
  readonly variant?: string
  readonly reasoning?: string
  readonly reasoningEffort?: string
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
}

type RuntimeChain = {
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
}

// A category's own `requested_model` is its chain HEAD, which is not the model it selected when an
// earlier rung was unavailable. Leading with that head would advertise a model the registry cannot
// serve, so each spec contributes its SELECTED model first and its remaining rungs after.
function selectedFirstRecords(spec: CategorySpecChain): readonly ResolvedModelRecord[] {
  const display = `${spec.provider}/${spec.modelId}`
  const reasoning = spec.reasoning ?? spec.reasoningEffort ?? spec.variant
  const selected: ResolvedModelRecord = {
    source: "agent",
    provider: spec.provider,
    model_id: spec.modelId,
    display,
    ...(reasoning !== undefined ? { variant: reasoning, reasoning } : {}),
  }
  const rest = [spec.requested_model, ...(spec.fallback_models ?? [])]
    .filter((record): record is ResolvedModelRecord => record !== undefined && record.display !== display)
  return [selected, ...rest]
}

// Winner chain first, then every later resolved category's chain, deduplicated by display and
// re-stamped as an agent-sourced record (the child ran because of the agent, not a category call).
function agentModelChain(specs: readonly CategorySpecChain[]): RuntimeChain {
  const records: ResolvedModelRecord[] = []
  const seen = new Set<string>()
  for (const spec of specs) {
    for (const record of selectedFirstRecords(spec)) {
      if (seen.has(record.display)) continue
      seen.add(record.display)
      records.push({ ...record, source: "agent" })
    }
  }
  const [requested, ...fallbacks] = records
  if (requested === undefined) return {}
  return {
    requested_model: requested,
    ...(fallbacks.length > 0 ? { fallback_models: fallbacks } : {}),
  }
}
