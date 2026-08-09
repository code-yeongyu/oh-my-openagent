import type { OhMyOpenCodeConfig } from "../../config"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { stringifyRuntimeModel } from "./fallback-state"
import { getConfiguredPrimaryModel } from "./fallback-models"
import { getAgentConfigKey } from "../../shared"

type ResolveFallbackBootstrapModelOptions = {
  sessionID: string
  source: string
  eventModel?: unknown
  resolvedAgent?: string
  pluginConfig?: OhMyOpenCodeConfig
}

export function resolveFallbackBootstrapModel(
  options: ResolveFallbackBootstrapModelOptions,
): string | undefined {
  const eventModel = stringifyRuntimeModel(options.eventModel)
  if (eventModel) {
    return eventModel
  }

  const agentConfigs = options.pluginConfig?.agents
  const agentConfig = options.resolvedAgent && agentConfigs
    ? agentConfigs[getAgentConfigKey(options.resolvedAgent, agentConfigs) as keyof typeof agentConfigs]
    : undefined
  const agentModel = getConfiguredPrimaryModel(agentConfig)
  if (agentModel) {
    log(`[${HOOK_NAME}] Derived model from agent config for ${options.source}`, {
      sessionID: options.sessionID,
      agent: options.resolvedAgent,
      model: agentModel,
    })
    return agentModel
  }

  const agentCategory = typeof agentConfig?.category === "string" ? agentConfig.category : undefined
  if (agentCategory) {
    const agentCategoryModel = getConfiguredPrimaryModel(options.pluginConfig?.categories?.[agentCategory])
    if (agentCategoryModel) {
      log(`[${HOOK_NAME}] Derived model from agent category config for ${options.source}`, {
        sessionID: options.sessionID,
        agent: options.resolvedAgent,
        category: agentCategory,
        model: agentCategoryModel,
      })
      return agentCategoryModel
    }
  }

  const sessionCategory = SessionCategoryRegistry.get(options.sessionID)
  const categoryModel = sessionCategory
    ? getConfiguredPrimaryModel(options.pluginConfig?.categories?.[sessionCategory])
    : undefined
  if (categoryModel) {
    log(`[${HOOK_NAME}] Derived model from session category config for ${options.source}`, {
      sessionID: options.sessionID,
      category: sessionCategory,
      model: categoryModel,
    })
    return categoryModel
  }

  return undefined
}
