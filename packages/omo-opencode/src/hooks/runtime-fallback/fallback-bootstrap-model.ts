import type { OhMyOpenCodeConfig } from "../../config"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { stringifyRuntimeModel } from "./fallback-state"
import { extractSessionMessages } from "./session-messages"
import { hasCompactionPart } from "../../shared/compaction-marker"
import { hasSubstantivePromptText } from "../../shared/runtime-fallback-retry-marker"

type ResolveFallbackBootstrapModelOptions = {
  sessionID: string
  source: string
  eventModel?: unknown
  resolvedAgent?: string
  pluginConfig?: OhMyOpenCodeConfig
  ctx?: {
    client: { session: { messages: (input: { path: { id: string }; query: { directory: string } }) => Promise<unknown> } }
    directory: string
  }
}

export async function resolveFallbackBootstrapModel(
  options: ResolveFallbackBootstrapModelOptions,
): Promise<string | undefined> {
  const eventModel = stringifyRuntimeModel(options.eventModel)
  if (eventModel) {
    return eventModel
  }

  if (options.ctx) {
    try {
      const response = await options.ctx.client.session.messages({
        path: { id: options.sessionID },
        query: { directory: options.ctx.directory },
      })
      const messages = extractSessionMessages(response)
      const lastUser = messages?.filter((message) => {
        if (message.info?.role !== "user") return false
        const propParts = Array.isArray(message.parts) ? message.parts : undefined
        const infoParts = Array.isArray(message.info?.parts) ? message.info.parts : undefined
        const parts = propParts && propParts.length > 0 ? propParts : infoParts
        if (hasCompactionPart(parts)) return false
        return hasSubstantivePromptText(parts)
      }).pop()
      const userModel = stringifyRuntimeModel(lastUser?.info?.model)
      if (userModel) {
        log(`[${HOOK_NAME}] fallback-bootstrap-from-last-user-model`, { sessionID: options.sessionID, model: userModel })
        return userModel
      }
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to resolve bootstrap model from session messages`, { sessionID: options.sessionID, error: String(error) })
    }
  }

  const agentConfigs = options.pluginConfig?.agents
  const agentConfig = options.resolvedAgent && agentConfigs
    ? agentConfigs[options.resolvedAgent as keyof typeof agentConfigs]
    : undefined
  const agentConfigRecord = agentConfig as Record<string, unknown> | undefined
  const agentModelCandidate = agentConfigRecord?.model
  const agentModel = typeof agentModelCandidate === "string" ? agentModelCandidate : undefined
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
