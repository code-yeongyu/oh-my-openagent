import type { OhMyOpenCodeConfig } from "../../config"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey } from "../../shared/agent-display-names"

type AgentCompactionConfig = { compaction?: { model?: string } }
type AgentOverrides = Record<string, AgentCompactionConfig | undefined>

export type CompactionModelDecision = {
  providerID: string
  modelID: string
  source: "pin" | "session"
  reason: string
  agentName: string | null
  agentConfigKey: string | null
  pinnedModel: string | null
}

/**
 * Resolve an agent override entry from its config key.
 *
 * `getAgentConfigKey` normalizes display names ("Sisyphus - ultraworker") to config
 * keys ("sisyphus"), but sessions can carry a canonical agent's persona-suffixed
 * variant that is absent from the display-name table. Those must still reach their
 * agent's pin instead of silently falling back to the session model.
 *
 * The suffix fallback is deliberately restricted to canonical agent keys
 * (`AGENT_DISPLAY_NAMES`): an unrelated custom agent must not borrow a pinned
 * agent's summarizer model.
 */
function findAgentConfig(
  agents: AgentOverrides,
  agentConfigKey: string,
): { key: string; config: AgentCompactionConfig } | undefined {
  const direct = agents[agentConfigKey]
  if (direct) return { key: agentConfigKey, config: direct }

  const lowerKey = agentConfigKey.toLowerCase()
  for (const [key, value] of Object.entries(agents)) {
    if (value && key.toLowerCase() === lowerKey) return { key, config: value }
  }

  const base = lowerKey.split(" - ")[0]?.trim()
  if (base && base !== lowerKey && AGENT_DISPLAY_NAMES[base] !== undefined) {
    for (const [key, value] of Object.entries(agents)) {
      if (value && key.toLowerCase() === base) return { key, config: value }
    }
  }

  return undefined
}

/**
 * Resolve the model used to summarize a session, and report *why*.
 *
 * The previous implementation returned the session model on every failure path
 * without logging anything, so a dead pin was indistinguishable from a working
 * one until the summary showed up on the wrong provider. Keep the decision
 * explicit so the caller can log it.
 */
export function resolveCompactionModelDecision(
  pluginConfig: OhMyOpenCodeConfig,
  sessionID: string,
  originalProviderID: string,
  originalModelID: string,
  fallbackAgentName?: string,
): CompactionModelDecision {
  const sessionAgentName = getSessionAgent(sessionID) ?? fallbackAgentName ?? null
  const sessionFallback = (
    reason: string,
    agentConfigKey?: string | null,
    pinnedModel?: string | null,
  ): CompactionModelDecision => ({
    providerID: originalProviderID,
    modelID: originalModelID,
    source: "session",
    reason,
    agentName: sessionAgentName,
    agentConfigKey: agentConfigKey ?? null,
    pinnedModel: pinnedModel ?? null,
  })

  if (!sessionAgentName) return sessionFallback("no-agent-name")
  if (!pluginConfig.agents) return sessionFallback("no-agents-config")

  const agentConfigKey = getAgentConfigKey(sessionAgentName)
  const match = findAgentConfig(pluginConfig.agents as AgentOverrides, agentConfigKey)
  if (!match) return sessionFallback("agent-not-configured", agentConfigKey)

  const pinnedModel = match.config.compaction?.model
  if (!pinnedModel) return sessionFallback("no-compaction-pin", agentConfigKey)

  const modelParts = pinnedModel.split("/")
  if (modelParts.length < 2) return sessionFallback("malformed-pin", agentConfigKey, pinnedModel)

  return {
    providerID: modelParts[0],
    modelID: modelParts.slice(1).join("/"),
    source: "pin",
    reason: `pin:${match.key}`,
    agentName: sessionAgentName,
    agentConfigKey,
    pinnedModel,
  }
}

export function resolveCompactionModel(
  pluginConfig: OhMyOpenCodeConfig,
  sessionID: string,
  originalProviderID: string,
  originalModelID: string,
  fallbackAgentName?: string
): { providerID: string; modelID: string } {
  const decision = resolveCompactionModelDecision(
    pluginConfig,
    sessionID,
    originalProviderID,
    originalModelID,
    fallbackAgentName
  )

  return { providerID: decision.providerID, modelID: decision.modelID }
}
