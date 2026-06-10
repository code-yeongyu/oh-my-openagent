import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { getRawFallbackModelsForScope } from "../runtime-fallback/fallback-models"

export function resolveCompactionModel(
  pluginConfig: OhMyOpenCodeConfig,
  sessionID: string,
  originalProviderID: string,
  originalModelID: string
): { providerID: string; modelID: string } {
  const sessionAgentName = getSessionAgent(sessionID)

  if (!sessionAgentName || !pluginConfig.agents) {
    return { providerID: originalProviderID, modelID: originalModelID }
  }

  const agentConfigKey = getAgentConfigKey(sessionAgentName)
  const agentConfig = (pluginConfig.agents as Record<string, { compaction?: { model?: string } } | undefined>)[agentConfigKey]
  const compactionConfig = agentConfig?.compaction

  if (!compactionConfig?.model) {
    return { providerID: originalProviderID, modelID: originalModelID }
  }

  const modelParts = compactionConfig.model.split("/")
  if (modelParts.length < 2) {
    return { providerID: originalProviderID, modelID: originalModelID }
  }

  return {
    providerID: modelParts[0],
    modelID: modelParts.slice(1).join("/"),
  }
}

/**
 * Resolves the compaction-scoped fallback chain for a session, if any. The
 * caller (e.g. summarize retry strategy) uses this when the primary
 * compaction model errors out — falling back to the agent-level chain when
 * no compaction-scoped fallback is set. See #3779 / #828 / #2062.
 */
export function resolveCompactionFallbackChain(
  pluginConfig: OhMyOpenCodeConfig,
  sessionID: string,
  currentProviderID: string,
): FallbackEntry[] | undefined {
  const sessionAgentName = getSessionAgent(sessionID)
  if (!sessionAgentName) return undefined
  const agentKey = getAgentConfigKey(sessionAgentName)

  const raw = getRawFallbackModelsForScope(sessionID, agentKey, pluginConfig, "compaction")
  if (!raw || raw.length === 0) return undefined

  return buildFallbackChainFromModels(raw, currentProviderID)
}
