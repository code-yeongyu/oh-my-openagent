import type { OhMyOpenCodeConfig } from "../../config"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

type EventModelLike = string | { providerID?: string; modelID?: string; id?: string; variant?: string } | undefined

type ResolveFallbackBootstrapModelOptions = {
  sessionID: string
  source: string
  eventModel?: EventModelLike
  resolvedAgent?: string
  pluginConfig?: OhMyOpenCodeConfig
}

export function normalizeRuntimeFallbackModel(model: EventModelLike): string | undefined {
  if (!model) return undefined
  if (typeof model === "string") {
    return model.length > 0 ? model : undefined
  }

  const providerID = typeof model.providerID === "string" ? model.providerID : undefined
  const modelID = typeof model.modelID === "string"
    ? model.modelID
    : (typeof model.id === "string" ? model.id : undefined)

  if (!providerID || !modelID) return undefined
  return `${providerID}/${modelID}`
}

export function resolveFallbackBootstrapModel(
  options: ResolveFallbackBootstrapModelOptions,
): string | undefined {
  const normalizedEventModel = normalizeRuntimeFallbackModel(options.eventModel)
  if (normalizedEventModel) {
    return normalizedEventModel
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

  const agentCategory = typeof agentConfig?.category === "string" ? agentConfig.category : undefined
  if (agentCategory) {
    const agentCategoryModel = options.pluginConfig?.categories?.[agentCategory]?.model
    if (typeof agentCategoryModel === "string" && agentCategoryModel.length > 0) {
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
