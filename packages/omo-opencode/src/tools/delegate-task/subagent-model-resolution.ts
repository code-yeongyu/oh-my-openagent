import type { AgentOverrides, FallbackModelObject } from "../../config/schema"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { buildFallbackChainFromModels, findMostSpecificFallbackEntry } from "../../shared/fallback-chain-from-models"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { flattenToFallbackModelStrings, normalizeFallbackModels } from "../../shared/model-resolver"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { log } from "../../shared/logger"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { applyCategoryParams } from "./delegated-model-config"
import type { ExecutorContext } from "./executor-types"
import { applyFallbackEntrySettings } from "./fallback-entry-settings"
import { resolveEffectiveFallbackEntry } from "./fallback-entry-resolution"
import { resolveModelForDelegateTask } from "./model-selection"
import type { AgentInfo } from "./subagent-discovery"
import type { ResolvedSubagentModel } from "./subagent-resolution-types"
import type { DelegatedModelConfig } from "./types"
import { distributeTaskModels } from "./models-distribution"

function findAgentOverride(agentOverrides: AgentOverrides | undefined, agentConfigKey: string) {
  return agentOverrides?.[agentConfigKey]
    ?? Object.entries(agentOverrides ?? {}).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1]
}

function modelStringFromEntry(entry: string | FallbackModelObject | undefined): string | undefined {
  if (entry === undefined) return undefined
  return typeof entry === "string" ? entry : entry.model
}

/**
 * The first `models[]` entry is the primary, and an object entry carries the whole model
 * contract (variant, reasoning, reasoningEffort, temperature, top_p, maxTokens, thinking).
 * Reading only `entry.model` silently drops those settings (#6869 review), so the resolved
 * config takes every field the entry defines. Applied after category params so the most
 * specific source, the primary entry, wins.
 */
function applyPrimaryEntrySettings(base: DelegatedModelConfig, entry: FallbackModelObject): DelegatedModelConfig {
  return {
    ...base,
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
    ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
    ...(entry.reasoningEffort !== undefined ? { reasoningEffort: entry.reasoningEffort } : {}),
    ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
    ...(entry.top_p !== undefined ? { top_p: entry.top_p } : {}),
    ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
    ...(entry.thinking !== undefined ? { thinking: entry.thinking } : {}),
  }
}

export async function resolveSubagentModel(
  agentToUse: string,
  matchedAgent: AgentInfo,
  executorCtx: ExecutorContext,
): Promise<ResolvedSubagentModel> {
  let categoryModel = undefined
  let fallbackChain = undefined

  const agentConfigKey = getAgentConfigKey(agentToUse)
  const agentOverride = findAgentOverride(executorCtx.agentOverrides, agentConfigKey)
  const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentConfigKey]
  const agentCategoryConfig = agentOverride?.category
    ? executorCtx.userCategories?.[agentOverride.category]
    : undefined
  const chainConfig = agentOverride?.models?.length
    ? agentOverride
    : !agentOverride?.model ? agentCategoryConfig : undefined
  const canonicalModels = chainConfig?.models_distribution === "round_robin" && chainConfig.models?.length
    ? [...distributeTaskModels(
        chainConfig === agentOverride ? `agent:${agentConfigKey}` : `category:${agentOverride?.category}`,
        chainConfig.models,
        "round_robin",
      )]
    : chainConfig?.models?.length
      ? [...chainConfig.models]
      : undefined
  const primaryEntry = canonicalModels?.[0]
  const explicitModel = modelStringFromEntry(primaryEntry)
    ?? agentOverride?.model ?? agentCategoryConfig?.model
  const hasExplicitUserModel = Boolean(explicitModel)
  const normalizedAgentFallbackModels = normalizeFallbackModels(
    canonicalModels && canonicalModels.length > 1
      ? canonicalModels.slice(1)
      : (agentOverride?.fallback_models ?? agentCategoryConfig?.fallback_models)
  )

  const availableModels = await getAvailableModelsForDelegateTask(executorCtx.client)
  const normalizedMatchedModel = matchedAgent.model
    ? normalizeModelFormat(matchedAgent.model)
    : undefined
  const matchedAgentModelStr = normalizedMatchedModel
    ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
    : undefined

  if (canonicalModels || agentOverride?.model || agentCategoryConfig?.model || agentRequirement || matchedAgent.model) {
    const resolution = resolveModelForDelegateTask({
      userModel: explicitModel,
      userFallbackModels: flattenToFallbackModelStrings(normalizedAgentFallbackModels),
      categoryDefaultModel: matchedAgentModelStr,
      fallbackChain: agentRequirement?.fallbackChain,
      availableModels,
      systemDefaultModel: undefined,
    })

    const resolutionSkipped = resolution && "skipped" in resolution

    if (resolution && !resolutionSkipped) {
      const normalized = normalizeModelFormat(resolution.model)
      if (normalized) {
        const variantToUse = agentOverride?.variant ?? resolution.variant ?? agentCategoryConfig?.variant
        const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
      }
    } else if (resolutionSkipped && explicitModel) {
      const normalized = explicitModel ? normalizeModelFormat(explicitModel) : undefined
      if (normalized) {
        const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant
        const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
        log("[delegate-task] Cold cache: using explicit user override for subagent", {
          agent: agentToUse,
          model: explicitModel,
        })
      }
    }

    // The primary entry's settings belong to the primary only: a promoted fallback keeps its
    // own settings through applyFallbackEntrySettings below.
    const promotedFallback = resolution !== undefined && !("skipped" in resolution) && resolution.matchedFallback === true
    if (categoryModel && !promotedFallback && primaryEntry !== undefined && typeof primaryEntry !== "string") {
      categoryModel = applyPrimaryEntrySettings(categoryModel, primaryEntry)
    }

    const defaultProviderID = categoryModel?.providerID
      ?? normalizedMatchedModel?.providerID
      ?? "opencode"
    const configuredFallbackChain = buildFallbackChainFromModels(
      normalizedAgentFallbackModels,
      defaultProviderID,
    )
    const canonicalChain = buildFallbackChainFromModels(canonicalModels, defaultProviderID)
    const canonicalEntry = categoryModel && canonicalChain
      ? findMostSpecificFallbackEntry(categoryModel.providerID, categoryModel.modelID, canonicalChain)
      : undefined
    fallbackChain = configuredFallbackChain
      ?? ((resolutionSkipped || hasExplicitUserModel) ? undefined : agentRequirement?.fallbackChain)
    if (canonicalChain && canonicalEntry) {
      fallbackChain = canonicalChain.slice(canonicalChain.indexOf(canonicalEntry) + 1)
    }
    const effectiveEntry = canonicalEntry ?? resolveEffectiveFallbackEntry({
      categoryModel,
      configuredFallbackChain,
      resolution,
    })

    if (categoryModel && effectiveEntry) {
      categoryModel = applyFallbackEntrySettings({
        categoryModel,
        effectiveEntry,
        variantOverride: agentOverride?.variant,
      })
    }
  }

  if (!categoryModel && normalizedMatchedModel) {
    const fullModel = `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
    if (availableModels.size === 0 || fuzzyMatchModel(fullModel, availableModels, [normalizedMatchedModel.providerID])) {
      categoryModel = normalizedMatchedModel
    } else {
      log("[delegate-task] Skipping unavailable agent default model", {
        agent: agentToUse,
        model: fullModel,
      })
    }
  }

  return { categoryModel, fallbackChain }
}
