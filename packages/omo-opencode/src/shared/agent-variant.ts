import { normalizeReasoning } from "@oh-my-opencode/model-core"
import type { GetModelCapabilitiesInput } from "@oh-my-opencode/model-core"
import type { OhMyOpenCodeConfig } from "../config"
import { stripInvisibleAgentCharacters } from "./agent-display-names"
import { getModelCapabilities } from "./model-capabilities"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

type ReasoningConfig = {
  reasoning?: string
  variant?: string
  category?: string
}

type ChainEntry = {
  providers: string[]
  model: string
  reasoning?: string
  variant?: string
}

type OpenCodeReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type LoweredReasoning = {
  variant?: string
  reasoningEffort?: OpenCodeReasoningEffort
}

export function lowerReasoningForModel(
  reasoning: string | undefined,
  model: GetModelCapabilitiesInput,
): LoweredReasoning {
  if (reasoning === undefined) return {}

  const normalized = normalizeReasoning(reasoning)
  if (normalized.passthrough) {
    return { variant: normalized.passthrough }
  }
  if (!normalized.level) return {}

  const capabilities = getModelCapabilities(model)
  if (capabilities.variants?.includes(normalized.level)) {
    return { variant: normalized.level }
  }
  if (normalized.level === "auto") return {}

  return {
    reasoningEffort: normalized.level === "off" ? "none" : normalized.level,
  }
}

function findAgentOverride(
  config: OhMyOpenCodeConfig,
  agentName: string,
): ReasoningConfig | undefined {
  const stripped = stripInvisibleAgentCharacters(agentName)
  const agentOverrides = config.agents as Record<string, ReasoningConfig> | undefined
  return agentOverrides
    ? agentOverrides[stripped]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === stripped.toLowerCase())?.[1]
    : undefined
}

function getCategoryConfig(
  config: OhMyOpenCodeConfig,
  categoryName: string | undefined,
): ReasoningConfig | undefined {
  return categoryName ? config.categories?.[categoryName] : undefined
}

export function resolveAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName?: string,
): string | undefined {
  if (!agentName) return undefined

  const agentOverride = findAgentOverride(config, agentName)
  if (!agentOverride) return undefined

  const categoryConfig = getCategoryConfig(config, agentOverride.category)
  return agentOverride.reasoning
    ?? categoryConfig?.reasoning
    ?? agentOverride.variant
    ?? categoryConfig?.variant
}

export function resolveVariantForModel(
  config: OhMyOpenCodeConfig,
  agentName: string,
  currentModel: { providerID: string; modelID: string },
): string | undefined {
  const stripped = stripInvisibleAgentCharacters(agentName)
  const agentOverride = findAgentOverride(config, agentName)
  const categoryName = agentOverride?.category
  const categoryConfig = getCategoryConfig(config, categoryName)
  const agentChain = AGENT_MODEL_REQUIREMENTS[stripped]?.fallbackChain as ChainEntry[] | undefined
  const categoryChain = categoryName
    ? CATEGORY_MODEL_REQUIREMENTS[categoryName]?.fallbackChain as ChainEntry[] | undefined
    : undefined
  const agentChainEntry = findEntryInChain(agentChain, currentModel)
  const categoryChainEntry = findEntryInChain(categoryChain, currentModel)

  return agentOverride?.reasoning
    ?? categoryConfig?.reasoning
    ?? agentChainEntry?.reasoning
    ?? categoryChainEntry?.reasoning
    ?? agentOverride?.variant
    ?? categoryConfig?.variant
    ?? agentChainEntry?.variant
    ?? categoryChainEntry?.variant
}

function findEntryInChain(
  fallbackChain: ChainEntry[] | undefined,
  currentModel: { providerID: string; modelID: string },
): ChainEntry | undefined {
  if (!fallbackChain) return undefined

  const exactMatch = fallbackChain.find((entry) => (
    entry.providers.includes(currentModel.providerID)
    && entry.model === currentModel.modelID
  ))
  if (exactMatch) return exactMatch

  // Some providers expose identical model IDs (e.g. OpenAI models via different providers).
  // If we didn't find an exact provider+model match, fall back to model-only matching.
  return fallbackChain.find((entry) => entry.model === currentModel.modelID)
}

export function applyAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName: string | undefined,
  message: { variant?: string },
  currentModel: { providerID: string; modelID: string },
): void {
  const variant = resolveAgentVariant(config, agentName)
  if (variant === undefined || message.variant !== undefined) return

  Object.assign(message, lowerReasoningForModel(variant, currentModel))
}
