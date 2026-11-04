import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackModelObject } from "../../config/schema/fallback-models"
import { agentPattern } from "./agent-resolver"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { normalizeFallbackModels, flattenToFallbackModelStrings } from "../../shared/model-resolver"
import { getDelegatedChildSessionBootstrap } from "../../shared/delegated-child-session-bootstrap"
import { getAgentConfigKey } from "../../shared/agent-display-names"

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
  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  const categoryConfig = sessionCategory ? pluginConfig.categories?.[sessionCategory] : undefined
  const agentKey = agent ? getAgentConfigKey(agent) : undefined
  const agentConfig = agentKey
    ? pluginConfig.agents?.[agentKey]
      ?? Object.entries(pluginConfig.agents ?? {}).find(([key]) => key.toLowerCase() === agentKey)?.[1]
    : undefined
  const agentCategoryConfig = agentConfig?.category ? pluginConfig.categories?.[agentConfig.category] : undefined
  const distribution = categoryConfig?.models_distribution
    ?? (agentConfig?.models?.length ? agentConfig.models_distribution
      : !agentConfig?.model ? agentCategoryConfig?.models_distribution : undefined)
  const bootstrap = distribution === "round_robin" ? getDelegatedChildSessionBootstrap(sessionID) : undefined
  if (bootstrap) {
    return bootstrap.fallbackChain?.flatMap(({ providers, model, ...settings }) =>
      providers.map((provider) => ({ ...settings, model: `${provider}/${model}` })),
    ) ?? []
  }
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    if (categoryConfig?.fallback_models) {
      return normalizeFallbackModels(categoryConfig.fallback_models)
    }
  }

  const tryGetFallbackFromAgent = (agentName: string): (string | FallbackModelObject)[] | undefined => {
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
