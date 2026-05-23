import type { OhMyOpenCodeConfig } from "../../config"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"

export function resolveCompactionModel(
  pluginConfig: OhMyOpenCodeConfig,
  sessionID: string,
  originalProviderID: string,
  originalModelID: string
): { providerID: string; modelID: string; fallbackModels?: unknown } {
  const sessionAgentName = getSessionAgent(sessionID)
  
  if (!sessionAgentName || !pluginConfig.agents) {
    return { providerID: originalProviderID, modelID: originalModelID }
  }

  const agentConfigKey = getAgentConfigKey(sessionAgentName)
  const agentConfig = (pluginConfig.agents as Record<string, { compaction?: { model?: string; fallback_models?: unknown } } | undefined>)[agentConfigKey]
  const compactionConfig = agentConfig?.compaction

  if (!compactionConfig?.model) {
    return {
      providerID: originalProviderID,
      modelID: originalModelID,
      fallbackModels: compactionConfig?.fallback_models,
    }
  }

  const modelParts = compactionConfig.model.split("/")
  if (modelParts.length < 2) {
    return {
      providerID: originalProviderID,
      modelID: originalModelID,
      fallbackModels: compactionConfig.fallback_models,
    }
  }

  return {
    providerID: modelParts[0],
    modelID: modelParts.slice(1).join("/"),
    fallbackModels: compactionConfig.fallback_models,
  }
}
