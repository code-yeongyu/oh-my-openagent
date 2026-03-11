import type { OhMyOpenCodeConfig } from "../../config"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

type ResolveFallbackBootstrapModelOptions = {
  sessionID: string
  source: string
  eventModel?: string
  resolvedAgent?: string
  pluginConfig?: OhMyOpenCodeConfig
}

export function resolveFallbackBootstrapModel(
  options: ResolveFallbackBootstrapModelOptions,
): string | undefined {
  if (options.eventModel) {
    return options.eventModel
  }

  const agentConfigs = options.pluginConfig?.agents
  const agentConfig = options.resolvedAgent && agentConfigs
    ? agentConfigs[options.resolvedAgent as keyof typeof agentConfigs]
    : undefined
  const agentModel = typeof agentConfig?.model === "string" ? agentConfig.model : undefined
  if (agentModel) {
    log(`[${HOOK_NAME}] Derived model from agent config for ${options.source}`, {
      sessionID: options.sessionID,
      agent: options.resolvedAgent,
      model: agentModel,
    })
    return agentModel
  }

  const sessionCategory = SessionCategoryRegistry.get(options.sessionID)
  const categoryModel = sessionCategory
    ? options.pluginConfig?.categories?.[sessionCategory]?.model
    : undefined
  if (typeof categoryModel === "string" && categoryModel.length > 0) {
    log(`[${HOOK_NAME}] Derived model from session category config for ${options.source}`, {
      sessionID: options.sessionID,
      category: sessionCategory,
      model: categoryModel,
    })
    return categoryModel
  }

  return undefined
}
