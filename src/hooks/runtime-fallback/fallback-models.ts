import type { OhMyOpenCodeConfig } from "../../config"
import { agentPattern } from "./agent-resolver"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { normalizeFallbackModels } from "../../shared/model-resolver"
import { isProviderBlacklisted } from "../../shared/global-blacklist"

function extractProviderFromModel(model: string): string | undefined {
  const parts = model.split("/")
  return parts.length > 0 ? parts[0] : undefined
}

async function filterBlacklistedProviders(
  models: string[],
  cooldownSeconds: number
): Promise<string[]> {
  const filtered: string[] = []
  
  for (const model of models) {
    const providerID = extractProviderFromModel(model)
    if (providerID) {
      const blacklisted = await isProviderBlacklisted(providerID)
      if (blacklisted) {
        log(`[${HOOK_NAME}] Filtering out blacklisted provider from fallback chain`, { 
          model, 
          provider: providerID 
        })
        continue
      }
    }
    filtered.push(model)
  }
  
  return filtered
}

export function getFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined
): string[] {
  if (!pluginConfig) return []
  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    if (categoryConfig?.fallback_models) {
      return normalizeFallbackModels(categoryConfig.fallback_models) ?? []
    }
  }
  const tryGetFallbackFromAgent = (agentName: string): string[] | undefined => {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (!agentConfig) return undefined
    
    if (agentConfig?.fallback_models) {
      return normalizeFallbackModels(agentConfig.fallback_models)
    }
    
    const agentCategory = agentConfig?.category
    if (agentCategory && pluginConfig.categories?.[agentCategory]) {
      const categoryConfig = pluginConfig.categories[agentCategory]
      if (categoryConfig?.fallback_models) {
        return normalizeFallbackModels(categoryConfig.fallback_models)
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
