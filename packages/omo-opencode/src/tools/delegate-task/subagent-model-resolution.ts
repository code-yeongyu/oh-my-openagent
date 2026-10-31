import type { AgentOverrides } from "../../config/schema"
import type { DelegatedModelConfig } from "./types"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
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

function findAgentOverride(agentOverrides: AgentOverrides | undefined, agentConfigKey: string) {
  return agentOverrides?.[agentConfigKey]
    ?? Object.entries(agentOverrides ?? {}).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1]
}

function modelStringFromEntry(entry: string | { model: string } | undefined): string | undefined {
  if (typeof entry === "string") return entry
  return entry?.model
}

/**
 * The first `models[]` entry is the primary. When it is an object it carries
 * per-model settings (reasoning/reasoningEffort/temperature/top_p/maxTokens/
 * thinking) that must be preserved — extracting only `entry.model` silently
 * drops the rest of the contract (#6869 review). Returns the base config with
 * the object's settings merged in, or the base untouched when the entry is a
 * plain string.
 */
function applyPrimaryEntrySettings(
  base: DelegatedModelConfig,
  entry: string | { model: string; reasoning?: string; variant?: string; reasoningEffort?: string; temperature?: number; top_p?: number; maxTokens?: number; thinking?: { type: "enabled" | "disabled"; budgetTokens?: number } },
): DelegatedModelConfig {
  if (typeof entry === "string" || entry === undefined) {
    return base
  }
  return {
    ...base,
    ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
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
  const agentCategoryModel = agentCategoryConfig?.model
  const canonicalAgentModels = agentOverride?.models ?? agentCategoryConfig?.models
  const canonicalPrimaryModel = modelStringFromEntry(canonicalAgentModels?.[0])
  const explicitUserModel = agentOverride?.model ?? agentCategoryModel
  const hasExplicitUserModel = Boolean(explicitUserModel ?? canonicalPrimaryModel)
  const normalizedAgentFallbackModels = normalizeFallbackModels(
    canonicalAgentModels && canonicalAgentModels.length > 1
      ? canonicalAgentModels.slice(1)
      : (agentOverride?.fallback_models ?? agentCategoryConfig?.fallback_models)
  )

  const availableModels = await getAvailableModelsForDelegateTask(executorCtx.client)
  const normalizedMatchedModel = matchedAgent.model
    ? normalizeModelFormat(matchedAgent.model)
    : undefined
  const matchedAgentModelStr = normalizedMatchedModel
    ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
    : undefined

  if (agentOverride?.model || agentCategoryModel || agentRequirement || matchedAgent.model) {
    const resolution = resolveModelForDelegateTask({
      userModel: explicitUserModel ?? canonicalPrimaryModel,
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
    } else if (resolutionSkipped && (explicitUserModel ?? canonicalPrimaryModel)) {
      const explicitModel = explicitUserModel ?? canonicalPrimaryModel
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

    // Preserve the full models[0] contract: when the primary entry is an
    // object, its per-model settings (reasoning, temperature, thinking, …)
    // must survive resolution instead of being dropped (#6869 review). The
    // primary entry is the most specific source, so it overrides category
    // params applied above.
    if (categoryModel && typeof canonicalAgentModels?.[0] === "object") {
      categoryModel = applyPrimaryEntrySettings(categoryModel, canonicalAgentModels[0])
    }

    const defaultProviderID = categoryModel?.providerID
      ?? normalizedMatchedModel?.providerID
      ?? "opencode"
    const configuredFallbackChain = buildFallbackChainFromModels(
      normalizedAgentFallbackModels,
      defaultProviderID,
    )
    fallbackChain = configuredFallbackChain
      ?? ((resolutionSkipped || hasExplicitUserModel) ? undefined : agentRequirement?.fallbackChain)
    const effectiveEntry = resolveEffectiveFallbackEntry({
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
