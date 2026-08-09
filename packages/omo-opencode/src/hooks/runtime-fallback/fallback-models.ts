import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackModelObject, FallbackModels } from "../../config/schema/fallback-models"
import { agentPattern } from "./agent-resolver"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { normalizeFallbackModels, flattenToFallbackModelStrings } from "../../shared/model-resolver"
import { getRuntimeFallbackModelIdentity } from "@oh-my-opencode/model-core"

type ModelChainConfig = {
  model?: string
  models?: (string | FallbackModelObject)[]
  fallback_models?: FallbackModels
  reasoning?: string
  variant?: string
  reasoningEffort?: FallbackModelObject["reasoningEffort"]
  temperature?: number
  top_p?: number
  provider_options?: Record<string, unknown>
  providerOptions?: Record<string, unknown>
  textVerbosity?: "low" | "medium" | "high"
  max_tokens?: number
  maxTokens?: number
  thinking?: FallbackModelObject["thinking"]
}

type ResolvedFallbackConfig = {
  config: ModelChainConfig
  inheritDefaults: boolean
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
  fallbackIndex?: number,
): FallbackModelObject | undefined {
  if (!pluginConfig) return undefined
  const resolved = resolveFallbackConfigForSession(sessionID, agent, pluginConfig)
  const config = resolved?.config
  const raw = getConfiguredFallbackModels(config)
  const flattened = flattenToFallbackModelStrings(raw)
  const indexedFallback = fallbackIndex ?? -1
  const indexedEntry = indexedFallback >= 0 ? raw?.[indexedFallback] : undefined
  const exactIndex = flattened?.indexOf(model) ?? -1
  const modelIdentity = getRuntimeFallbackModelIdentity(model)
  const index = indexedEntry !== undefined
    ? indexedFallback
    : exactIndex >= 0
      ? exactIndex
      : flattened?.findIndex((candidate) => getRuntimeFallbackModelIdentity(candidate) === modelIdentity) ?? -1
  const entry = raw?.[index]
  if (entry === undefined || config === undefined) return undefined
  const selected = typeof entry === "string" ? { model: entry } : entry
  const defaults = resolved?.inheritDefaults ? config : {}
  const providerOptions = {
    ...defaults.providerOptions,
    ...(defaults.textVerbosity === undefined ? {} : { textVerbosity: defaults.textVerbosity }),
    ...defaults.provider_options,
    ...selected.provider_options,
  }
  const hasSelectedReasoning = selected.reasoning !== undefined
    || selected.variant !== undefined
    || selected.reasoningEffort !== undefined
  return {
    model: selected.model,
    reasoning: selected.reasoning ?? (hasSelectedReasoning ? undefined : defaults.reasoning),
    variant: selected.variant ?? (hasSelectedReasoning ? undefined : defaults.variant),
    reasoningEffort: selected.reasoningEffort ?? (hasSelectedReasoning ? undefined : defaults.reasoningEffort),
    temperature: selected.temperature ?? defaults.temperature,
    top_p: selected.top_p ?? defaults.top_p,
    provider_options: Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
    maxTokens: selected.max_tokens ?? selected.maxTokens ?? defaults.max_tokens ?? defaults.maxTokens,
    thinking: selected.thinking ?? defaults.thinking,
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
  return getConfiguredFallbackModels(resolveFallbackConfigForSession(sessionID, agent, pluginConfig)?.config)
}

function resolveFallbackConfigForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig,
): ResolvedFallbackConfig | undefined {
  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    const fallbackModels = getConfiguredFallbackModels(categoryConfig)
    if (fallbackModels !== undefined) return { config: categoryConfig, inheritDefaults: true }
  }

  const tryGetFallbackFromAgent = (agentName: string): ResolvedFallbackConfig | undefined => {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (!agentConfig) return undefined

    const agentFallbackModels = getConfiguredFallbackModels(agentConfig)
    if (agentFallbackModels !== undefined) {
      return { config: agentConfig, inheritDefaults: agentConfig.models === undefined }
    }

    const agentCategory = agentConfig?.category
    if (agentCategory && pluginConfig.categories?.[agentCategory]) {
      const categoryConfig = pluginConfig.categories[agentCategory]
      const categoryFallbackModels = getConfiguredFallbackModels(categoryConfig)
      if (categoryFallbackModels !== undefined) return { config: categoryConfig, inheritDefaults: true }
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
