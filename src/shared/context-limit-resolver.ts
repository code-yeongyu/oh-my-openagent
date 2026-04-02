import process from "node:process"

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

function supportsCachedAnthropicLimit(modelID: string): boolean {
  return /^claude-(opus|sonnet)-4(?:-|\.)6(?:-high)?$/.test(modelID)
}

export function resolveActualContextLimit(
  providerID: string,
  modelID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number | null {
  if (isAnthropicProvider(providerID)) {
    const explicit1M = getAnthropicActualLimit(modelCacheState)
    if (explicit1M === 1_000_000) return explicit1M

    const cachedLimit = modelCacheState?.modelContextLimitsCache?.get(`${providerID}/${modelID}`)
    if (cachedLimit && supportsCachedAnthropicLimit(modelID)) return cachedLimit

    return DEFAULT_ANTHROPIC_ACTUAL_LIMIT
  }

  return modelCacheState?.modelContextLimitsCache?.get(`${providerID}/${modelID}`) ?? null
}
