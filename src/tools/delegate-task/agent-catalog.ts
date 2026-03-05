import type { OpencodeClient } from "./types"
import { normalizeSDKResponse } from "../../shared"
import { getAgentDisplayName } from "../../shared/agent-display-names"

export interface AgentInfo {
  name: string
  mode?: "subagent" | "primary" | "all"
  model?: string | { providerID: string; modelID: string }
}

export interface TaskAgentCatalog {
  all: AgentInfo[]
  callable: AgentInfo[]
  primary: AgentInfo[]
}

export interface AgentMatch {
  agent: AgentInfo
  canonicalName: string
}

export async function getTaskAgentCatalog(
  client: OpencodeClient
): Promise<TaskAgentCatalog | null> {
  try {
    const agentsResult = await client.app.agents()
    const agents = normalizeSDKResponse(agentsResult, [] as AgentInfo[], {
      preferResponseOnMissingData: true,
    })

    if (!agents || agents.length === 0) {
      return null
    }

    return {
      all: agents,
      callable: agents.filter((a) => a.mode !== "primary"),
      primary: agents.filter((a) => a.mode === "primary"),
    }
  } catch {
    return null
  }
}

/**
 * Matches an agent name against the catalog using canonical name resolution.
 * Returns the matched agent with its canonical name from the catalog.
 */
export function matchAgentByName(
  name: string,
  catalog: TaskAgentCatalog
): AgentMatch | null {
  const trimmedName = name.trim()
  if (!trimmedName) {
    return null
  }

  const resolvedDisplayName = getAgentDisplayName(trimmedName)
  const lowerName = trimmedName.toLowerCase()
  const lowerDisplayName = resolvedDisplayName.toLowerCase()

  const matchedAgent = catalog.callable.find(
    (agent) =>
      agent.name.toLowerCase() === lowerName ||
      agent.name.toLowerCase() === lowerDisplayName
  )

  if (!matchedAgent) {
    return null
  }

  return {
    agent: matchedAgent,
    canonicalName: matchedAgent.name,
  }
}

/**
 * Matches an agent name against primary agents in the catalog.
 * Returns the matched primary agent with its canonical name.
 */
export function matchPrimaryAgentByName(
  name: string,
  catalog: TaskAgentCatalog
): AgentMatch | null {
  const trimmedName = name.trim()
  if (!trimmedName) {
    return null
  }

  const resolvedDisplayName = getAgentDisplayName(trimmedName)
  const lowerName = trimmedName.toLowerCase()
  const lowerDisplayName = resolvedDisplayName.toLowerCase()

  const matchedAgent = catalog.primary.find(
    (agent) =>
      agent.name.toLowerCase() === lowerName ||
      agent.name.toLowerCase() === lowerDisplayName
  )

  if (!matchedAgent) {
    return null
  }

  return {
    agent: matchedAgent,
    canonicalName: matchedAgent.name,
  }
}
