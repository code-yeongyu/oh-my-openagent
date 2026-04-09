import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import type { DelegatedModelConfig } from "./types"
import { isPlanFamily } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { normalizeFallbackModels, flattenToFallbackModelStrings } from "../../shared/model-resolver"
import { buildFallbackChainFromModels, findMostSpecificFallbackEntry } from "../../shared/fallback-chain-from-models"
import { getAgentDisplayName, getAgentConfigKey } from "../../shared/agent-display-names"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { getAvailableModelsForDelegateTask } from "./available-models"
import type { FallbackEntry } from "../../shared/model-requirements"
import { resolveModelForDelegateTask } from "./model-selection"
import { fuzzyMatchModel } from "../../shared/model-availability"
import type { CategoryConfig } from "../../config/schema"

type AgentMode = "subagent" | "primary" | "all" | undefined

function applyCategoryParams(
  base: DelegatedModelConfig,
  config: CategoryConfig | undefined,
): DelegatedModelConfig {
  if (!config) {
    return base
  }

  return {
    ...base,
    ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.top_p !== undefined ? { top_p: config.top_p } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
  }
}

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string
): Promise<{ agentToUse: string; categoryModel: DelegatedModelConfig | undefined; fallbackChain?: FallbackEntry[]; error?: string }> {
  const { client, agentOverrides, userCategories } = executorCtx

  if (!args.subagent_type?.trim()) {
    return { agentToUse: "", categoryModel: undefined, error: `Agent name cannot be empty.` }
  }

  // Strip wrapping characters (backslashes, quotes) that LLMs sometimes add around agent names
  // e.g. \hephaestus\ -> hephaestus, "oracle" -> oracle, 'explore' -> explore
  const agentName = args.subagent_type.trim().replace(/^[\\\/"']+|[\\\/"']+$/g, "").trim()

  if (agentName.toLowerCase() === SISYPHUS_JUNIOR_AGENT.toLowerCase()) {
    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Cannot use subagent_type="${SISYPHUS_JUNIOR_AGENT}" directly. Use category parameter instead (e.g., ${categoryExamples}).

Sisyphus-Junior is spawned automatically when you specify a category. Pick the appropriate category for your task domain.`,
    }
  }

  if (isPlanFamily(agentName) && isPlanFamily(parentAgent)) {
    return {
      agentToUse: "",
      categoryModel: undefined,
    error: `You are a plan-family agent (plan/prometheus). You cannot delegate to other plan-family agents via task.

Create the work plan directly - that's your job as the planning agent.`,
    }
  }

  let agentToUse = agentName
  let categoryModel: DelegatedModelConfig | undefined
  let fallbackChain: FallbackEntry[] | undefined = undefined

  try {
    const agentsResult = await client.app.agents()
    type AgentInfo = {
      name: string
      mode?: "subagent" | "primary" | "all"
      model?: string | { providerID: string; modelID: string }
    }
    const agents = normalizeSDKResponse(agentsResult, [] as AgentInfo[], {
      preferResponseOnMissingData: true,
    })

    const callableAgents = agents.filter((agent) => isTaskCallableAgentMode(agent.mode))

    const resolvedDisplayName = getAgentDisplayName(agentToUse).replace(/^\u200B+/, "")
    const normalizedAgentToUse = agentToUse.replace(/^\u200B+/, "")
    const matchedAgent = callableAgents.find(
      (agent) => agent.name.toLowerCase() === normalizedAgentToUse.toLowerCase()
        || agent.name.toLowerCase() === resolvedDisplayName.toLowerCase()
    )
    if (!matchedAgent) {
      const availableAgents = callableAgents
        .map((a) => a.name)
        .sort()
        .join(", ")
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unknown agent: "${agentToUse}". Available agents: ${availableAgents}`,
      }
    }

    agentToUse = matchedAgent.name

    const agentConfigKey = getAgentConfigKey(agentToUse)
    const agentOverride = agentOverrides?.[agentConfigKey as keyof typeof agentOverrides]
      ?? (agentOverrides ? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1] : undefined)
    const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentConfigKey]
    const agentCategoryConfig = agentOverride?.category
      ? userCategories?.[agentOverride.category]
      : undefined
    const agentCategoryModel = agentCategoryConfig?.model
    const normalizedAgentFallbackModels = normalizeFallbackModels(
      agentOverride?.fallback_models
      ?? agentCategoryConfig?.fallback_models
    )

    const availableModels = await getAvailableModelsForDelegateTask(client)

    if (agentOverride?.model || agentCategoryModel || agentRequirement || matchedAgent.model) {

      const normalizedMatchedModel = matchedAgent.model
        ? normalizeModelFormat(matchedAgent.model)
        : undefined
      const matchedAgentModelStr = normalizedMatchedModel
        ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
        : undefined

      const resolution = resolveModelForDelegateTask({
        userModel: agentOverride?.model ?? agentCategoryModel,
        userFallbackModels: flattenToFallbackModelStrings(normalizedAgentFallbackModels),
        categoryDefaultModel: matchedAgentModelStr,
        fallbackChain: agentRequirement?.fallbackChain,
        availableModels,
        systemDefaultModel: undefined,
      })

      const resolutionSkipped = resolution && 'skipped' in resolution

      if (resolution && !resolutionSkipped) {
        const normalized = normalizeModelFormat(resolution.model)
        if (normalized) {
          const variantToUse = agentOverride?.variant ?? resolution.variant ?? agentCategoryConfig?.variant
          const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
          categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
        }
      } else if (resolutionSkipped && (agentOverride?.model ?? agentCategoryModel)) {
        const normalized = normalizeModelFormat((agentOverride?.model ?? agentCategoryModel)!)
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
      fallbackChain = configuredFallbackChain ?? (resolutionSkipped ? undefined : agentRequirement?.fallbackChain)

      // Only promote fallback-only settings when resolution actually selected a fallback model.
      const resolvedFallbackEntry = (resolution && !('skipped' in resolution)) ? resolution.fallbackEntry : undefined
      const matchedFallback = (resolution && !('skipped' in resolution)) ? resolution.matchedFallback === true : false
      const effectiveEntry = matchedFallback && categoryModel
        ? (
            resolvedFallbackEntry
            ?? (configuredFallbackChain
              ? findMostSpecificFallbackEntry(categoryModel.providerID, categoryModel.modelID, configuredFallbackChain)
              : undefined)
          )
        : undefined

      if (categoryModel && effectiveEntry) {
        categoryModel = {
          ...categoryModel,
          variant: agentOverride?.variant ?? effectiveEntry.variant ?? categoryModel.variant,
          reasoningEffort: effectiveEntry.reasoningEffort ?? categoryModel.reasoningEffort,
          temperature: effectiveEntry.temperature ?? categoryModel.temperature,
          top_p: effectiveEntry.top_p ?? categoryModel.top_p,
          maxTokens: effectiveEntry.maxTokens ?? categoryModel.maxTokens,
          thinking: effectiveEntry.thinking ?? categoryModel.thinking,
        }
      }
    }

    if (!categoryModel && matchedAgent.model) {
      const normalizedMatchedModel = normalizeModelFormat(matchedAgent.model)
      if (normalizedMatchedModel) {
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
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[delegate-task] Failed to resolve subagent execution", {
      requestedAgent: agentToUse,
      parentAgent,
      error: errorMessage,
    })

    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Failed to delegate to agent "${agentToUse}": ${errorMessage}`,
    }
  }

  return { agentToUse, categoryModel, fallbackChain }
}

function isTaskCallableAgentMode(mode: AgentMode): boolean {
  return mode === "all" || mode === "subagent"
}
