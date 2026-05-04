import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackModelObject } from "../../config/schema/fallback-models"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { normalizeFallbackModels } from "../../shared/model-resolver"

export type ResolvedCompactionModel = {
  providerID: string
  modelID: string
  fallback_models?: (string | FallbackModelObject)[]
}

export function resolveCompactionModel(
  pluginConfig: OhMyOpenCodeConfig,
  sessionID: string,
  originalProviderID: string,
  originalModelID: string
): ResolvedCompactionModel {
  const sessionAgentName = getSessionAgent(sessionID)
  
  if (!sessionAgentName || !pluginConfig.agents) {
    return { providerID: originalProviderID, modelID: originalModelID }
  }

  const agentConfigKey = getAgentConfigKey(sessionAgentName)
  const agentConfig = pluginConfig.agents[agentConfigKey as keyof typeof pluginConfig.agents]
  const compactionConfig = agentConfig?.compaction
  const fallbackModels = normalizeFallbackModels(compactionConfig?.fallback_models)

  if (!compactionConfig?.model) {
    return {
      providerID: originalProviderID,
      modelID: originalModelID,
      ...(fallbackModels ? { fallback_models: fallbackModels } : {}),
    }
  }

  const modelParts = compactionConfig.model.split("/")
  if (modelParts.length < 2) {
    return {
      providerID: originalProviderID,
      modelID: originalModelID,
      ...(fallbackModels ? { fallback_models: fallbackModels } : {}),
    }
  }

  return {
    providerID: modelParts[0],
    modelID: modelParts.slice(1).join("/"),
    ...(fallbackModels ? { fallback_models: fallbackModels } : {}),
  }
}
