import type { OhMyOpenCodeConfig } from "../config"
import { findCaseInsensitive } from "./case-insensitive"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

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
  const agentOverride = agentOverrides ? findCaseInsensitive(agentOverrides, agentName) : undefined
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
  const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentName]
  if (agentRequirement) {
    return findVariantInChain(agentRequirement.fallbackChain, currentModel.providerID)
  }

  const agentOverrides = config.agents as
    | Record<string, { category?: string }>
    | undefined
  const agentOverride = agentOverrides ? findCaseInsensitive(agentOverrides, agentName) : undefined
  const categoryName = agentOverride?.category
  if (categoryName) {
    const categoryRequirement = CATEGORY_MODEL_REQUIREMENTS[categoryName]
    if (categoryRequirement) {
      return findVariantInChain(categoryRequirement.fallbackChain, currentModel.providerID)
    }
  }

  return undefined
}

function findVariantInChain(
  fallbackChain: { providers: string[]; model: string; variant?: string }[],
  providerID: string,
): string | undefined {
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
