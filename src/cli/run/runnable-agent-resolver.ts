import { normalizeSDKResponse } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"

interface AgentListItem {
  readonly name?: string
}

export interface RunAgentListClient {
  readonly app: {
    readonly agents: () => Promise<unknown>
  }
}

export async function resolveRunnableRunAgent(
  client: RunAgentListClient,
  resolvedAgent: string,
): Promise<string> {
  try {
    const agentsRes = await client.app.agents()
    const agents = normalizeSDKResponse(agentsRes, [] as readonly AgentListItem[], {
      preferResponseOnMissingData: true,
    })
    const exactAgent = agents.find((agent) => agent.name === resolvedAgent)?.name
    if (exactAgent) return exactAgent

    const resolvedConfigKey = getAgentConfigKey(resolvedAgent)
    return agents.find((agent) => {
      if (!agent.name) return false
      return getAgentConfigKey(agent.name) === resolvedConfigKey
    })?.name ?? resolvedAgent
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return resolvedAgent
  }
}
