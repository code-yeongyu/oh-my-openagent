import type { AgentOverrides } from "../../config/schema"
import {
  AGENT_MODEL_REQUIREMENTS,
  applyCategoryParams,
  applyFallbackEntrySettings,
  buildFallbackChainFromModels,
  findMostSpecificFallbackEntry,
  flattenToFallbackModelStrings,
  fuzzyMatchModel,
  getAgentConfigKey,
  log,
  normalizeFallbackModels,
  normalizeModelFormat,
} from "../../shared"
import { getAvailableModelsForDelegateTask } from "./available-models"
import type { ExecutorContext } from "./executor-types"
import { resolveEffectiveFallbackEntry } from "./fallback-entry-resolution"
import { resolveModelForDelegateTask } from "./model-selection"
import type { AgentInfo } from "./subagent-discovery"
import type { ResolvedSubagentModel } from "./subagent-resolution-types"

function findAgentOverride(agentOverrides: AgentOverrides | undefined, agentConfigKey: string) {
  return agentOverrides?.[agentConfigKey]
    ?? Object.entries(agentOverrides ?? {}).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1]
}

function getConfiguredModel(entry: string | { model: string } | undefined): string | undefined {
  return typeof entry === "string" ? entry : entry?.model
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
  const agentPrimaryModel = getConfiguredModel(agentOverride?.models?.[0])
  const agentCategoryModel = getConfiguredModel(agentCategoryConfig?.models?.[0])
    ?? agentCategoryConfig?.model
  const userModel = agentPrimaryModel ?? agentOverride?.model ?? agentCategoryModel
  const canonicalModels = agentOverride?.models
    ?? (agentOverride?.model === undefined ? agentCategoryConfig?.models : undefined)
  const hasExplicitUserModel = Boolean(userModel)
  const normalizedAgentFallbackModels = normalizeFallbackModels(
    agentOverride?.models !== undefined
      ? agentOverride.models.slice(1)
      : agentOverride?.fallback_models
        ?? (agentCategoryConfig?.models !== undefined
          ? agentCategoryConfig.models.slice(1)
          : agentCategoryConfig?.fallback_models)
  )

  const availableModels = await getAvailableModelsForDelegateTask(executorCtx.client)
  const normalizedMatchedModel = matchedAgent.model
    ? normalizeModelFormat(matchedAgent.model)
    : undefined
  const matchedAgentModelStr = normalizedMatchedModel
    ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
    : undefined

  if (userModel || agentRequirement || matchedAgent.model) {
    const resolution = resolveModelForDelegateTask({
      userModel,
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
    } else if (resolutionSkipped && userModel) {
      const explicitModel = userModel
      const normalized = explicitModel ? normalizeModelFormat(explicitModel) : undefined
      if (normalized) {
        const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant
        const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
        log("[delegate-task] Cold cache: using explicit user override for subagent", {
          agent: agentToUse,
          model: userModel,
        })
      }
    }

    const defaultProviderID = categoryModel?.providerID
      ?? normalizedMatchedModel?.providerID
      ?? "opencode"
    const configuredFallbackChain = buildFallbackChainFromModels(
      normalizedAgentFallbackModels,
      defaultProviderID,
    )
    const canonicalModelChain = canonicalModels
      ? buildFallbackChainFromModels(canonicalModels, defaultProviderID)
      : undefined
    fallbackChain = configuredFallbackChain
      ?? ((resolutionSkipped || hasExplicitUserModel) ? undefined : agentRequirement?.fallbackChain)
    const effectiveEntry = categoryModel && canonicalModelChain
      ? findMostSpecificFallbackEntry(categoryModel.providerID, categoryModel.modelID, canonicalModelChain)
      : resolveEffectiveFallbackEntry({
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
