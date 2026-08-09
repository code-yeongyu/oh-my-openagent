import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared"

type AgentOverrides = Record<string, { displayName?: string } | undefined>

export const AGENT_NAMES = [
  "sisyphus",
  "oracle",
  "librarian",
  "explore",
  "prometheus",
  "atlas",
  "metis",
  "momus",
  "hephaestus",
  "sisyphus-junior",
  "build",
  "plan",
  "multimodal-looker",
]

export const agentPattern = new RegExp(
  `\\b(${AGENT_NAMES
    .sort((a, b) => b.length - a.length)
    .map((a) => a.replace(/-/g, "\\-"))
    .join("|")})\\b`,
  "i",
)

export function detectAgentFromSession(sessionID: string): string | undefined {
  const match = sessionID.match(agentPattern)
  if (match) {
    return match[1].toLowerCase()
  }
  return undefined
}

export function normalizeAgentName(
  agent: string | undefined,
  overrides?: AgentOverrides,
): string | undefined {
  if (!agent) return undefined
  const configuredKey = getAgentConfigKey(agent, overrides)
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, configuredKey)) {
    return configuredKey
  }
  const normalized = agent.toLowerCase().trim()
  if (AGENT_NAMES.includes(normalized)) {
    return normalized
  }
  const match = normalized.match(agentPattern)
  if (match) {
    return match[1].toLowerCase()
  }
  return undefined
}

export function resolveAgentForSession(
  sessionID: string,
  eventAgent?: string,
  overrides?: AgentOverrides,
): string | undefined {
  return (
    normalizeAgentName(eventAgent, overrides) ??
    normalizeAgentName(getSessionAgent(sessionID), overrides) ??
    detectAgentFromSession(sessionID)
  )
}
