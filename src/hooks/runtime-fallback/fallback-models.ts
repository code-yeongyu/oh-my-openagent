import type { MatrixxConfig } from "../../config"
import { log } from "../../shared/logger"
import { agentPattern } from "./agent-resolver"
import { HOOK_NAME } from "./constants"
import { flattenToFallbackModelStrings, normalizeFallbackModels } from "./model-utils"
import { SessionCategoryRegistry } from "./session-category-registry"

export function getFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: MatrixxConfig | undefined
): string[] {
  if (!pluginConfig) return []

  const raw = getRawFallbackModelsForSession(sessionID, agent, pluginConfig)
  return flattenToFallbackModelStrings(raw) ?? []
}

function getRawFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: MatrixxConfig,
): string[] | undefined {
  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    if (categoryConfig?.fallback_models) {
      return normalizeFallbackModels(categoryConfig.fallback_models as string | string[] | undefined)
    }
  }

  const tryGetFallbackFromAgent = (agentName: string): string[] | undefined => {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (!agentConfig) return undefined

    const agentCategory = agentConfig?.category
    if (agentCategory && pluginConfig.categories?.[agentCategory]) {
      const categoryConfig = pluginConfig.categories[agentCategory]
      if (categoryConfig?.fallback_models) {
        return normalizeFallbackModels(categoryConfig.fallback_models as string | string[] | undefined)
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

  return undefined
}
