import process from "node:process"
import { getModelCapabilities } from "./model-capabilities"

const DEFAULT_ANTHROPIC_ACTUAL_LIMIT = 200_000
export type ContextLimitModelCacheState = {
  anthropicContext1MEnabled: boolean
  modelContextLimitsCache?: Map<string, number>
}

function isAnthropicProvider(providerID: string): boolean {
  const normalized = providerID.toLowerCase()
  return normalized === "anthropic" || normalized === "google-vertex-anthropic" || normalized === "aws-bedrock-anthropic"
}

function getAnthropicActualLimit(modelCacheState?: ContextLimitModelCacheState): number {
  return (modelCacheState?.anthropicContext1MEnabled ?? false) ||
    process.env.ANTHROPIC_1M_CONTEXT === "true" ||
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : DEFAULT_ANTHROPIC_ACTUAL_LIMIT
}

function getConfiguredContextLimit(
  providerID: string,
  modelID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number | null {
  return modelCacheState?.modelContextLimitsCache?.get(`${providerID}/${modelID}`) ?? null
}

function getDiscoveredContextLimit(providerID: string, modelID: string): number | null {
  return getModelCapabilities({ providerID, modelID }).contextWindowTokens ?? null
}

export function resolveActualContextLimit(
  providerID: string,
  modelID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number | null {
  const configuredLimit = getConfiguredContextLimit(providerID, modelID, modelCacheState)
  const discoveredLimit = configuredLimit ?? getDiscoveredContextLimit(providerID, modelID)

  if (isAnthropicProvider(providerID)) {
    const explicit1M = getAnthropicActualLimit(modelCacheState)
    if (explicit1M === 1_000_000) {
      return discoveredLimit !== null ? Math.max(discoveredLimit, explicit1M) : explicit1M
    }

    return discoveredLimit ?? DEFAULT_ANTHROPIC_ACTUAL_LIMIT
  }

  return discoveredLimit
}
