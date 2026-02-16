import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import { isPlanFamily } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { parseModelString } from "./model-string-parser"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { getAgentDisplayName, getAgentConfigKey } from "../../shared/agent-display-names"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { resolveModelForDelegateTask } from "./model-selection"

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string
): Promise<{ agentToUse: string; categoryModel: { providerID: string; modelID: string; variant?: string } | undefined; error?: string }> {
  const { client, agentOverrides } = executorCtx

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

  try {
    const agentsResult = await client.app.agents()
    type AgentInfo = { name: string; mode?: "subagent" | "primary" | "all"; model?: { providerID: string; modelID: string } }
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

    if (agentOverride?.model || agentRequirement || matchedAgent.model) {
      const availableModels = await getAvailableModelsForDelegateTask(client)

      const matchedAgentModelStr = matchedAgent.model
        ? `${matchedAgent.model.providerID}/${matchedAgent.model.modelID}`
        : undefined

      const resolution = resolveModelForDelegateTask({
        userModel: agentOverride?.model,
        categoryDefaultModel: matchedAgentModelStr,
        fallbackChain: agentRequirement?.fallbackChain,
        availableModels,
        systemDefaultModel: undefined,
      })

      if (resolution) {
        const parsed = parseModelString(resolution.model)
        if (parsed) {
          const variantToUse = agentOverride?.variant ?? resolution.variant
          categoryModel = variantToUse ? { ...parsed, variant: variantToUse } : parsed
        }
      }
    }

    if (!categoryModel && matchedAgent.model) {
      categoryModel = matchedAgent.model
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

  return { agentToUse, categoryModel }
}
