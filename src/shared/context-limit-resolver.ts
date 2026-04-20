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
  // Accept both 4.6 and 4-6, and 4.7 and 4-7 forms
  return /^claude-(opus|sonnet)-4(?:-|\.)[67](?:-high)?$/.test(modelID)
}

// Generate possible alias forms for Claude 4.6/4-6 and 4.7/4-7 variants
function generateClaudeAliasForms(modelID: string): string[] {
  const forms = new Set<string>([modelID])
  if (modelID.includes("4.6")) forms.add(modelID.replace("4.6", "4-6"))
  if (modelID.includes("4-6")) forms.add(modelID.replace("4-6", "4.6"))
  if (modelID.includes("4.7")) forms.add(modelID.replace("4.7", "4-7"))
  if (modelID.includes("4-7")) forms.add(modelID.replace("4-7", "4.7"))
  return Array.from(forms)
}

export function resolveActualContextLimit(
  providerID: string,
  modelID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number | null {
  if (isAnthropicProvider(providerID)) {
    const explicit1M = getAnthropicActualLimit(modelCacheState)
    if (explicit1M === 1_000_000) return explicit1M

    // Try all alias forms for Claude models to maximize cache hits
    const keysToTry = generateClaudeAliasForms(modelID).map(
      (m) => `${providerID}/${m}`,
    )
    const cache = modelCacheState?.modelContextLimitsCache
    if (cache) {
      for (const key of keysToTry) {
        const cachedLimit = cache.get(key)
        if (cachedLimit && supportsCachedAnthropicLimit(modelID)) return cachedLimit
      }
    }

    // Fallback to default if nothing found
    return DEFAULT_ANTHROPIC_ACTUAL_LIMIT
  }

  return modelCacheState?.modelContextLimitsCache?.get(`${providerID}/${modelID}`) ?? null
}
