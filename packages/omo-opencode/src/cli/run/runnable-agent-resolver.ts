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

export interface RunAgentDisplayNameConfig {
  readonly agents?: Readonly<Record<string, { readonly displayName?: string } | undefined>>
}

export async function resolveRunnableRunAgent(
  client: RunAgentListClient,
  resolvedAgent: string,
  config: RunAgentDisplayNameConfig = {},
): Promise<string> {
  try {
    const agentsRes = await client.app.agents()
    const agents = normalizeSDKResponse(agentsRes, [] as readonly AgentListItem[], {
      preferResponseOnMissingData: true,
    })
    const exactAgent = agents.find((agent) => agent.name === resolvedAgent)?.name
    if (exactAgent) return exactAgent

    const resolvedConfigKey = getAgentConfigKey(resolvedAgent)
    const configuredDisplayName = config.agents?.[resolvedConfigKey]?.displayName
    const configuredAgent = agents.find((agent) => {
      if (!agent.name || !configuredDisplayName) return false
      return agent.name === configuredDisplayName
    })?.name
    if (configuredAgent) return configuredAgent

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
