const DEFAULT_CONTEXT_LIMIT = 200_000
const ENV_OVERRIDE_LIMIT = 1_000_000
const ANTHROPIC_PROVIDER_PREFIXES = ["anthropic", "vertex-anthropic"]

export function isAnthropicProvider(providerID?: string): boolean {
  if (!providerID) return false
  return ANTHROPIC_PROVIDER_PREFIXES.some(
    (prefix) => providerID === prefix || providerID.startsWith(`${prefix}/`),
  )
}

export interface ContextWindowLimitOptions {
  contextWindowLimit?: number
  providerID?: string
  modelID?: string
  modelContextLimitsCache?: Map<string, number>
}

// Precedence: explicit override → env var → model cache → default (200k)
export function resolveContextWindowLimit(
  options: ContextWindowLimitOptions = {},
): number {
  const { contextWindowLimit, providerID, modelID, modelContextLimitsCache } =
    options

  if (contextWindowLimit !== undefined) {
    return contextWindowLimit
  }

  if (
    process.env.ANTHROPIC_1M_CONTEXT === "true" ||
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
  ) {
    return ENV_OVERRIDE_LIMIT
  }

  if (providerID && modelID && modelContextLimitsCache) {
    const cacheKey = `${providerID}/${modelID}`
    const cached = modelContextLimitsCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  return DEFAULT_CONTEXT_LIMIT
}
