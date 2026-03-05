import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import { isPlanFamily } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { normalizeFallbackModels } from "../../shared/model-resolver"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { getAgentDisplayName, getAgentConfigKey } from "../../shared/agent-display-names"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { getAvailableModelsForDelegateTask } from "./available-models"
import type { FallbackEntry } from "../../shared/model-requirements"
import { resolveModelForDelegateTask } from "./model-selection"
import { matchAgentByName, matchPrimaryAgentByName, type TaskAgentCatalog } from "./agent-catalog"

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string,
  preFetchedCatalog?: TaskAgentCatalog | null
): Promise<{ agentToUse: string; categoryModel: { providerID: string; modelID: string; variant?: string } | undefined; fallbackChain?: FallbackEntry[]; error?: string }> {
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
  let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  let fallbackChain: FallbackEntry[] | undefined = undefined

  try {
    // Use pre-fetched catalog if available to avoid double-fetch
    const agentCatalog = preFetchedCatalog !== undefined ? preFetchedCatalog : await (async () => {
      const { getTaskAgentCatalog } = await import("./agent-catalog")
      return getTaskAgentCatalog(client)
    })()

    if (!agentCatalog) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Failed to fetch agent catalog for "${agentToUse}"`,
      }
    }

    const match = matchAgentByName(agentToUse, agentCatalog)

    if (!match) {
      // Check if it's a primary agent using shared matcher
      const primaryMatch = matchPrimaryAgentByName(agentToUse, agentCatalog)

      if (primaryMatch) {
        return {
          agentToUse: "",
          categoryModel: undefined,
    error: `Cannot call primary agent "${primaryMatch.canonicalName}" via task. Primary agents are top-level orchestrators.`,
        }
      }

      const availableAgents = agentCatalog.callable
        .map((a) => a.name)
        .sort()
        .join(", ")
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unknown agent: "${agentToUse}". Available agents: ${availableAgents}`,
      }
    }

    agentToUse = match.canonicalName
    const matchedAgent = match.agent

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
        userFallbackModels: normalizedAgentFallbackModels,
        categoryDefaultModel: matchedAgentModelStr,
        fallbackChain: agentRequirement?.fallbackChain,
        availableModels,
        systemDefaultModel: undefined,
      })

      if (resolution) {
        const normalized = normalizeModelFormat(resolution.model)
        if (normalized) {
          const variantToUse = agentOverride?.variant ?? resolution.variant
          categoryModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        }
      }

      const defaultProviderID = categoryModel?.providerID
        ?? normalizedMatchedModel?.providerID
        ?? "opencode"
      const configuredFallbackChain = buildFallbackChainFromModels(
        normalizedAgentFallbackModels,
        defaultProviderID,
      )
      fallbackChain = configuredFallbackChain ?? agentRequirement?.fallbackChain
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
