import type { OpencodeClient } from "@opencode-ai/sdk"
import { normalizeSDKResponse } from "../../shared"

interface AgentProfile {
  name?: string
  color?: string
}

export async function loadAgentProfileColors(
  client: OpencodeClient,
): Promise<Record<string, string>> {
  try {
    const agentsRes = await client.app.agents()
    const agents = normalizeSDKResponse(agentsRes, [] as AgentProfile[], {
      preferResponseOnMissingData: true,
    })

    const colors: Record<string, string> = {}
    for (const agent of agents) {
      if (!agent.name || !agent.color) continue
      colors[agent.name] = agent.color
    }

    return colors
  } catch {
    return {}
  }
}
