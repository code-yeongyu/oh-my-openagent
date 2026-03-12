import type { OhMyOpenCodeConfig } from "../../config"
import { agentPattern } from "./agent-resolver"
import { HOOK_NAME, isProviderBlacklisted, globalProviderBlacklist } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { normalizeFallbackModels } from "../../shared/model-resolver"

function extractProviderFromModel(model: string): string | undefined {
  const parts = model.split("/")
  return parts.length > 0 ? parts[0] : undefined
}

function filterBlacklistedProviders(
  models: string[],
  cooldownSeconds: number
): string[] {
  return models.filter(model => {
    const providerID = extractProviderFromModel(model)
    if (providerID && isProviderBlacklisted(providerID, cooldownSeconds)) {
      log(`[${HOOK_NAME}] Filtering out blacklisted provider from fallback chain`, { 
        model, 
        provider: providerID,
        blacklistSize: globalProviderBlacklist.size
      })
      return false
    }
    return true
  })
}

export function getFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined,
  cooldownSeconds: number = 60
): string[] {
  if (!pluginConfig) return []

  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    if (categoryConfig?.fallback_models) {
      const models = normalizeFallbackModels(categoryConfig.fallback_models) ?? []
      return filterBlacklistedProviders(models, cooldownSeconds)
    }
  }

  const tryGetFallbackFromAgent = (agentName: string): string[] | undefined => {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (!agentConfig) return undefined
    
    if (agentConfig?.fallback_models) {
      const models = normalizeFallbackModels(agentConfig.fallback_models)
      return models ? filterBlacklistedProviders(models, cooldownSeconds) : undefined
    }
    
    const agentCategory = agentConfig?.category
    if (agentCategory && pluginConfig.categories?.[agentCategory]) {
      const categoryConfig = pluginConfig.categories[agentCategory]
      if (categoryConfig?.fallback_models) {
        const models = normalizeFallbackModels(categoryConfig.fallback_models)
        return models ? filterBlacklistedProviders(models, cooldownSeconds) : undefined
      }
    }
    
    return undefined
  }

  if (agent) {
    const result = tryGetFallbackFromAgent(agent)
    if (result) return result
  }

  const sessionAgentMatch = sessionID.match(agentPattern)
  if (sessionAgentMatch) {
    const detectedAgent = sessionAgentMatch[1].toLowerCase()
    const result = tryGetFallbackFromAgent(detectedAgent)
    if (result) return result
  }

  log(`[${HOOK_NAME}] No category/agent fallback models resolved for session`, { sessionID, agent })

  return []
}
