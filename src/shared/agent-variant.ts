import type { OhMyOpenCodeConfig } from "../config"
import { findCaseInsensitive } from "./case-insensitive"
import { 
  AGENT_MODEL_REQUIREMENTS, 
  CATEGORY_MODEL_REQUIREMENTS, 
  getEffectiveFallbackChain,
  getEffectiveCategoryFallbackChain,
  type FallbackEntry 
} from "./model-requirements"

const MODEL_PREFIXES_TO_STRIP = ["antigravity-", "proxy-", "custom-"]

function normalizeModelId(modelId: string): string {
  let normalized = modelId
  for (const prefix of MODEL_PREFIXES_TO_STRIP) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length)
      break
    }
  }
  return normalized
}

function modelMatches(modelId: string, pattern: string): boolean {
  if (modelId === pattern) return true
  if (normalizeModelId(modelId) === pattern) return true
  if (modelId === normalizeModelId(pattern)) return true
  if (normalizeModelId(modelId) === normalizeModelId(pattern)) return true
  return false
}

type AgentOverrideWithFallback = { 
  variant?: string
  category?: string
  fallback_chain?: FallbackEntry[]
}

type CategoryConfigWithFallback = {
  variant?: string
  fallback_chain?: FallbackEntry[]
}

export function resolveAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName?: string
): string | undefined {
  if (!agentName) {
    return undefined
  }

  const agentOverrides = config.agents as
    | Record<string, { variant?: string; category?: string }>
    | undefined
  const agentOverride = agentOverrides
    ? agentOverrides[agentName]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    : undefined
  if (!agentOverride) {
    return undefined
  }

  if (agentOverride.variant) {
    return agentOverride.variant
  }

  const categoryName = agentOverride.category
  if (!categoryName) {
    return undefined
  }

  return config.categories?.[categoryName]?.variant
}

export function resolveVariantForModel(
  config: OhMyOpenCodeConfig,
  agentName: string,
  currentModel: { providerID: string; modelID: string },
): string | undefined {
  const agentOverrides = config.agents as
    | Record<string, AgentOverrideWithFallback>
    | undefined
  const agentOverride = agentOverrides ? findCaseInsensitive(agentOverrides, agentName) : undefined

  const userAgentFallback = agentOverride?.fallback_chain
  const effectiveAgentChain = getEffectiveFallbackChain(agentName, userAgentFallback)
  
  if (effectiveAgentChain.length > 0) {
    const chainVariant = findVariantInChain(
      effectiveAgentChain,
      currentModel.providerID,
      currentModel.modelID
    )
    if (chainVariant) return chainVariant
  }

  const categoryName = agentOverride?.category
  if (categoryName) {
    const categoryConfig = config.categories?.[categoryName] as CategoryConfigWithFallback | undefined
    const userCategoryFallback = categoryConfig?.fallback_chain
    const effectiveCategoryChain = getEffectiveCategoryFallbackChain(categoryName, userCategoryFallback)
    
    if (effectiveCategoryChain.length > 0) {
      const chainVariant = findVariantInChain(
        effectiveCategoryChain,
        currentModel.providerID,
        currentModel.modelID
      )
      if (chainVariant) return chainVariant
    }
    if (categoryConfig?.variant) return categoryConfig.variant
  }

  if (agentOverride?.variant) return agentOverride.variant

  return undefined
}

function findVariantInChain(
  fallbackChain: FallbackEntry[],
  providerID: string,
  modelID?: string,
): string | undefined {
  for (const entry of fallbackChain) {
    if (entry.providers.includes(providerID)) {
      if (modelID && entry.model) {
        if (modelMatches(modelID, entry.model)) {
          return entry.variant
        }
      } else {
        return entry.variant
      }
    }
  }
  for (const entry of fallbackChain) {
    if (entry.providers.includes(providerID)) {
      return entry.variant
    }
  }
  return undefined
}

export function applyAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName: string | undefined,
  message: { variant?: string }
): void {
  const variant = resolveAgentVariant(config, agentName)
  if (variant !== undefined && message.variant === undefined) {
    message.variant = variant
  }
}
