import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import { isPlanAgent } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string
): Promise<{ agentToUse: string; categoryModel: { providerID: string; modelID: string } | undefined; error?: string }> {
  const { client } = executorCtx

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

  if (isPlanAgent(agentName) && isPlanAgent(parentAgent)) {
    return {
      agentToUse: "",
      categoryModel: undefined,
    error: `You are prometheus. You cannot delegate to prometheus via task.

Create the work plan directly - that's your job as the planning agent.`,
    }
  }

  let agentToUse = agentName
  let categoryModel: { providerID: string; modelID: string } | undefined

  try {
    const agentsResult = await client.app.agents()
    type AgentInfo = { name: string; mode?: "subagent" | "primary" | "all"; model?: { providerID: string; modelID: string } }
    const agents = (agentsResult as { data?: AgentInfo[] }).data ?? agentsResult as unknown as AgentInfo[]

    const callableAgents = agents.filter((a) => a.mode !== "primary")

    const matchedAgent = callableAgents.find(
      (agent) => agent.name.toLowerCase() === agentToUse.toLowerCase()
    )
    if (!matchedAgent) {
      const isPrimaryAgent = agents
        .filter((a) => a.mode === "primary")
        .find((agent) => agent.name.toLowerCase() === agentToUse.toLowerCase())

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

    if (matchedAgent.model) {
      categoryModel = matchedAgent.model
    }
  } catch {
    // Proceed anyway - session.prompt will fail with clearer error if agent doesn't exist
  }

  return { agentToUse, categoryModel }
}
