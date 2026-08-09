import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackModelObject, FallbackModels } from "../../config/schema/fallback-models"
import { agentPattern } from "./agent-resolver"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { normalizeFallbackModels, flattenToFallbackModelStrings } from "../../shared/model-resolver"

type ModelChainConfig = {
  model?: string
  models?: (string | FallbackModelObject)[]
  fallback_models?: FallbackModels
  reasoning?: string
  variant?: string
  reasoningEffort?: FallbackModelObject["reasoningEffort"]
  temperature?: number
  top_p?: number
  maxTokens?: number
  thinking?: FallbackModelObject["thinking"]
}

function getConfiguredFallbackModels(
  config: ModelChainConfig | undefined,
): (string | FallbackModelObject)[] | undefined {
  if (config?.models !== undefined) return normalizeFallbackModels(config.models.slice(1))
  if (config?.fallback_models !== undefined) return normalizeFallbackModels(config.fallback_models)
  return undefined
}

/**
 * Returns fallback model strings for the runtime-fallback system.
 * Object entries are flattened to "provider/model(variant)" strings so the
 * string-based fallback state machine can work with them unchanged.
 */
export function getFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined
): string[] {
  if (!pluginConfig) return []

  const raw = getRawFallbackModelsForSession(sessionID, agent, pluginConfig)
  return flattenToFallbackModelStrings(raw) ?? []
}

export function getFallbackModelSettingsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined,
  model: string,
): FallbackModelObject | undefined {
  if (!pluginConfig) return undefined
  const config = resolveFallbackConfigForSession(sessionID, agent, pluginConfig)
  const raw = getConfiguredFallbackModels(config)
  const index = flattenToFallbackModelStrings(raw)?.indexOf(model) ?? -1
  const entry = raw?.[index]
  if (entry === undefined || config === undefined) return undefined
  const selected = typeof entry === "string" ? { model: entry } : entry
  const hasSelectedReasoning = selected.reasoning !== undefined
    || selected.variant !== undefined
    || selected.reasoningEffort !== undefined
  return {
    model: selected.model,
    reasoning: selected.reasoning ?? (hasSelectedReasoning ? undefined : config.reasoning),
    variant: selected.variant ?? (hasSelectedReasoning ? undefined : config.variant),
    reasoningEffort: selected.reasoningEffort ?? (hasSelectedReasoning ? undefined : config.reasoningEffort),
    temperature: selected.temperature ?? config.temperature,
    top_p: selected.top_p ?? config.top_p,
    maxTokens: selected.maxTokens ?? config.maxTokens,
    thinking: selected.thinking ?? config.thinking,
  }
}

export function getConfiguredPrimaryModel(config: ModelChainConfig | undefined): string | undefined {
  const primary = config?.models?.[0]
  if (typeof primary === "string") return primary
  if (primary !== undefined) return primary.model
  return config?.model
}

/**
 * Returns the raw fallback model entries (strings and objects) for a session.
 * Use this when per-model settings (temperature, reasoningEffort, etc.) must be
 * preserved - e.g. before passing to buildFallbackChainFromModels.
 */
export function getRawFallbackModels(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined,
): (string | FallbackModelObject)[] | undefined {
  if (!pluginConfig) return undefined
  return getRawFallbackModelsForSession(sessionID, agent, pluginConfig)
}

function getRawFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig,
): (string | FallbackModelObject)[] | undefined {
  return getConfiguredFallbackModels(resolveFallbackConfigForSession(sessionID, agent, pluginConfig))
}

function resolveFallbackConfigForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig,
): ModelChainConfig | undefined {
  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    const fallbackModels = getConfiguredFallbackModels(categoryConfig)
    if (fallbackModels !== undefined) return categoryConfig
  }

  const tryGetFallbackFromAgent = (agentName: string): ModelChainConfig | undefined => {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (!agentConfig) return undefined

    const agentFallbackModels = getConfiguredFallbackModels(agentConfig)
    if (agentFallbackModels !== undefined) return agentConfig

    const agentCategory = agentConfig?.category
    if (agentCategory && pluginConfig.categories?.[agentCategory]) {
      const categoryConfig = pluginConfig.categories[agentCategory]
      const categoryFallbackModels = getConfiguredFallbackModels(categoryConfig)
      if (categoryFallbackModels !== undefined) return categoryConfig
    }

    return undefined
  }

  const shouldInheritPlanFallback =
    pluginConfig.sisyphus_agent?.disabled !== true &&
    pluginConfig.sisyphus_agent?.planner_enabled !== false &&
    pluginConfig.sisyphus_agent?.replace_plan !== false
  const tryGetPrometheusFallbackForPlan = (agentName: string) => {
    if (agentName.toLowerCase() !== "plan" || !shouldInheritPlanFallback) return undefined
    return tryGetFallbackFromAgent("prometheus")
  }

  if (agent) {
    const result = tryGetFallbackFromAgent(agent)
    if (result) return result
    const planFallback = tryGetPrometheusFallbackForPlan(agent)
    if (planFallback) return planFallback
  }

  const sessionAgentMatch = sessionID.match(agentPattern)
  if (sessionAgentMatch) {
    const detectedAgent = sessionAgentMatch[1].toLowerCase()
    const result = tryGetFallbackFromAgent(detectedAgent)
    if (result) return result
    const planFallback = tryGetPrometheusFallbackForPlan(detectedAgent)
    if (planFallback) return planFallback
  }

  log(`[${HOOK_NAME}] No category/agent fallback models resolved for session`, { sessionID, agent })

  return undefined
}
