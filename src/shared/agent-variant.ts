import type { OhMyOpenCodeConfig } from "../config"
import { getModelCapabilities } from "./model-capabilities"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import { normalizeModelID } from "./model-normalization"

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
    | Record<string, { variant?: string; category?: string }>
    | undefined
  const agentOverride = agentOverrides
    ? agentOverrides[agentName]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    : undefined
  if (agentOverride?.variant) {
    return agentOverride.variant
  }

  const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentName]
  if (agentRequirement) {
    return findVariantInChain(agentRequirement.fallbackChain, currentModel)
  }
  const categoryName = agentOverride?.category
  if (categoryName) {
    const categoryRequirement = CATEGORY_MODEL_REQUIREMENTS[categoryName]
    if (categoryRequirement) {
      return findVariantInChain(categoryRequirement.fallbackChain, currentModel)
    }
  }

  return undefined
}

function findVariantInChain(
  fallbackChain: { providers: string[]; model: string; variant?: string }[],
  currentModel: { providerID: string; modelID: string },
): string | undefined {
  const currentCapabilities = getModelCapabilities(currentModel)
  const currentFamily = currentCapabilities.family
  const normalizedCurrentModelID = normalizeModelID(currentModel.modelID.trim().toLowerCase())

  for (const entry of fallbackChain) {
    if (!entry.providers.includes(currentModel.providerID)) {
      continue
    }

    const normalizedEntryModelID = normalizeModelID(entry.model.trim().toLowerCase())
    const entryCapabilities = getModelCapabilities({
      providerID: currentModel.providerID,
      modelID: entry.model,
    })
    const entryFamily = entryCapabilities.family

    if (
      normalizedEntryModelID === normalizedCurrentModelID
      || (entryFamily !== undefined && entryFamily === currentFamily)
    ) {
      return entry.variant
    }
  }

  // Some providers expose identical model IDs (e.g. OpenAI models via different providers).
  // If we didn't find an exact provider+model match, fall back to model-only matching.
  for (const entry of fallbackChain) {
    const normalizedEntryModelID = normalizeModelID(entry.model.trim().toLowerCase())
    const entryCapabilities = getModelCapabilities({
      providerID: currentModel.providerID,
      modelID: entry.model,
    })
    const entryFamily = entryCapabilities.family

    if (
      normalizedEntryModelID === normalizedCurrentModelID
      || (entryFamily !== undefined && entryFamily === currentFamily)
    ) {
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
