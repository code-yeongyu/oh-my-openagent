import type { AgentOverrides } from "../../config/schema"
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

function decodeFileUriPath(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw)
  } catch (error) {
    log("[delegate-task] Ignoring malformed file URI while scanning agent override aliases", {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

function toAliasSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function collectOverrideAliasNames(override: AgentOverrides[string]): string[] {
  const names = new Set<string>()
  if (override?.displayName) {
    const slug = toAliasSlug(override.displayName)
    if (slug) names.add(slug)
  }
  const promptAppend = override?.prompt_append
  if (promptAppend?.startsWith("file://")) {
    const decoded = decodeFileUriPath(promptAppend.slice("file://".length))
    const base = decoded?.split(/[\\/]/).pop() ?? ""
    const stem = base.replace(/\.[^.]+$/, "")
    const slug = toAliasSlug(stem)
    if (slug) names.add(slug)
  }
  return [...names]
}

function findAgentOverride(agentOverrides: AgentOverrides | undefined, agentToUse: string) {
  const agentConfigKey = getAgentConfigKey(agentToUse)
  const direct = agentOverrides?.[agentConfigKey]
    ?? Object.entries(agentOverrides ?? {}).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1]
  if (direct) {
    return direct
  }

  const aliasMatch = Object.entries(agentOverrides ?? {}).find(
    ([, override]) => collectOverrideAliasNames(override).includes(toAliasSlug(agentConfigKey)),
  )
  if (aliasMatch) {
    log("[delegate-task] Matched agent override via reverse alias", {
      agent: agentToUse,
      overrideKey: aliasMatch[0],
    })
  }
  return aliasMatch?.[1]
}

export async function resolveSubagentModel(
  agentToUse: string,
  matchedAgent: AgentInfo,
  executorCtx: ExecutorContext,
): Promise<ResolvedSubagentModel> {
  let categoryModel = undefined
  let fallbackChain = undefined

  const agentOverride = findAgentOverride(executorCtx.agentOverrides, agentToUse)
  const agentRequirement = AGENT_MODEL_REQUIREMENTS[getAgentConfigKey(agentToUse)]
  const agentCategoryConfig = agentOverride?.category
    ? executorCtx.userCategories?.[agentOverride.category]
    : undefined
  const agentCategoryModel = agentCategoryConfig?.model
  const hasExplicitUserModel = Boolean(agentOverride?.model ?? agentCategoryModel)
  const normalizedAgentFallbackModels = normalizeFallbackModels(
    agentOverride?.fallback_models
    ?? agentCategoryConfig?.fallback_models
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
      userModel: agentOverride?.model ?? agentCategoryModel,
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
    } else if (resolutionSkipped && (agentOverride?.model ?? agentCategoryModel)) {
      const explicitModel = agentOverride?.model ?? agentCategoryModel
      const normalized = explicitModel ? normalizeModelFormat(explicitModel) : undefined
      if (normalized) {
        const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant
        const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
        log("[delegate-task] Cold cache: using explicit user override for subagent", {
          agent: agentToUse,
          model: agentOverride?.model ?? agentCategoryModel,
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
