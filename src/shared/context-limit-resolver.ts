import process from "node:process"
import { getModelCapabilities } from "./model-capabilities"

export type ContextLimitModelCacheState = {
  anthropicContext1MEnabled?: boolean
  modelContextLimitsCache?: Map<string, number>
  providerContextLimitMinimumsCache?: Map<string, number>
}

type ContextLimitResolverOptions = {
  getModelCapabilities?: typeof getModelCapabilities
}

function isAnthropicProvider(providerID: string): boolean {
  const normalized = providerID.toLowerCase()
  return normalized === "anthropic" || normalized === "google-vertex-anthropic" || normalized === "aws-bedrock-anthropic"
}

function getLegacyAnthropicProviderMinimum(
  providerID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number | null {
  if (!isAnthropicProvider(providerID)) {
    return null
  }

  return (modelCacheState?.anthropicContext1MEnabled ?? false) ||
    process.env.ANTHROPIC_1M_CONTEXT === "true" ||
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : null
}

function getConfiguredContextLimit(
  providerID: string,
  modelID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number | null {
  return modelCacheState?.modelContextLimitsCache?.get(`${providerID}/${modelID}`) ?? null
}

function getDiscoveredContextLimit(
  providerID: string,
  modelID: string,
  options?: ContextLimitResolverOptions,
): number | null {
  return (options?.getModelCapabilities ?? getModelCapabilities)({ providerID, modelID }).contextWindowTokens ?? null
}

function getConfiguredProviderMinimumContextLimit(
  providerID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number | null {
  return modelCacheState?.providerContextLimitMinimumsCache?.get(providerID) ?? null
}

export function resolveActualContextLimit(
  providerID: string,
  modelID: string,
  modelCacheState?: ContextLimitModelCacheState,
  options?: ContextLimitResolverOptions,
): number | null {
  const configuredLimit = getConfiguredContextLimit(providerID, modelID, modelCacheState)
  const discoveredLimit = configuredLimit ?? getDiscoveredContextLimit(providerID, modelID, options)
  const providerMinimum =
    getConfiguredProviderMinimumContextLimit(providerID, modelCacheState)
    ?? getLegacyAnthropicProviderMinimum(providerID, modelCacheState)

  if (providerMinimum !== null) {
    return discoveredLimit !== null
      ? Math.max(discoveredLimit, providerMinimum)
      : providerMinimum
  }

  return discoveredLimit
}
