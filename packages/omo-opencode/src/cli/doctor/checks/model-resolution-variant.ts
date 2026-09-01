import type { ModelRequirement } from "../../../shared/model-requirements"
import type { OmoConfig } from "./model-resolution-types"

export function formatModelWithVariant(model: string, variant?: string): string {
  return variant ? `${model} (${variant})` : model
}

function getAgentOverride(
  agentName: string,
  config: OmoConfig
): { variant?: string; category?: string } | undefined {
  const agentOverrides = config.agents
  if (!agentOverrides) return undefined

  return (
    agentOverrides[agentName] ??
    Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
  )
}

export function getEffectiveVariant(
  agentName: string,
  requirement: ModelRequirement,
  config: OmoConfig
): string | undefined {
  const agentOverride = getAgentOverride(agentName, config)

  if (agentOverride?.variant) {
    return agentOverride.variant
  }

  const categoryName = agentOverride?.category
  if (categoryName) {
    const categoryVariant = config.categories?.[categoryName]?.variant
    if (categoryVariant) {
      return categoryVariant
    }
  }

  const firstEntry = requirement.fallbackChain[0]
  return firstEntry?.variant ?? requirement.variant
}

export function getCategoryEffectiveVariant(
  categoryName: string,
  requirement: ModelRequirement,
  config: OmoConfig
): string | undefined {
  const categoryVariant = config.categories?.[categoryName]?.variant
  if (categoryVariant) {
    return categoryVariant
  }
  const firstEntry = requirement.fallbackChain[0]
  return firstEntry?.variant ?? requirement.variant
}
