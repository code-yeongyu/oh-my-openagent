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

  const agentName = args.subagent_type.trim()

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

    const callableAgents = agents.filter((a) => a.mode !== "primary")

    const resolvedDisplayName = getAgentDisplayName(agentToUse)
    const matchedAgent = callableAgents.find(
      (agent) => agent.name.toLowerCase() === agentToUse.toLowerCase()
        || agent.name.toLowerCase() === resolvedDisplayName.toLowerCase()
    )
    if (!matchedAgent) {
      const isPrimaryAgent = agents
        .filter((a) => a.mode === "primary")
        .find((agent) => agent.name.toLowerCase() === agentToUse.toLowerCase()
          || agent.name.toLowerCase() === resolvedDisplayName.toLowerCase())

      if (isPrimaryAgent) {
        return {
          agentToUse: "",
          categoryModel: undefined,
    error: `Cannot call primary agent "${isPrimaryAgent.name}" via task. Primary agents are top-level orchestrators.`,
        }
      }

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
    const normalizedAgentFallbackModels = normalizeFallbackModels(
      agentOverride?.fallback_models
      ?? (agentOverride?.category ? userCategories?.[agentOverride.category]?.fallback_models : undefined)
    )

    if (agentOverride?.model || agentRequirement || matchedAgent.model) {
      const availableModels = await getAvailableModelsForDelegateTask(client)

      const normalizedMatchedModel = matchedAgent.model
        ? normalizeModelFormat(matchedAgent.model)
        : undefined
      const matchedAgentModelStr = normalizedMatchedModel
        ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
        : undefined

      const resolution = resolveModelForDelegateTask({
        userModel: agentOverride?.model,
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
          const variantToUse = agentOverride?.variant ?? resolution.variant
          categoryModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        }
      } else if (resolutionSkipped && agentOverride?.model) {
        // Cold cache: resolution was skipped but user explicitly configured a model.
        // Honor the user override directly — don't fall through to hardcoded fallback chain.
        const normalized = normalizeModelFormat(agentOverride.model)
        if (normalized) {
          const variantToUse = agentOverride?.variant
          categoryModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
          log("[delegate-task] Cold cache: using explicit user override for subagent", {
            agent: agentToUse,
            model: agentOverride.model,
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
      // Don't assign hardcoded fallback chain when resolution was skipped (cold cache)
      // — the chain may contain model IDs that don't exist in the provider yet.
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
          reasoningEffort: effectiveEntry.reasoningEffort,
          temperature: effectiveEntry.temperature,
          top_p: effectiveEntry.top_p,
          maxTokens: effectiveEntry.maxTokens,
          thinking: effectiveEntry.thinking,
        }
      }
    }

    if (!categoryModel && matchedAgent.model) {
      const normalizedMatchedModel = normalizeModelFormat(matchedAgent.model)
      if (normalizedMatchedModel) {
        categoryModel = normalizedMatchedModel
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
