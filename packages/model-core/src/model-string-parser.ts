const KNOWN_VARIANTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "minimal",
  "none",
  "auto",
  "thinking",
])

export function parseVariantFromModelID(rawModelID: string): { modelID: string; variant?: string } {
  if (typeof rawModelID !== "string") {
    return { modelID: "" }
  }
  const trimmedModelID = rawModelID.trim()
  if (!trimmedModelID) {
    return { modelID: "" }
  }

  const parenthesizedVariant = trimmedModelID.match(/^(.*)\(([^()]+)\)\s*$/)
  if (parenthesizedVariant) {
    const modelID = parenthesizedVariant[1]?.trim() ?? ""
    const variant = parenthesizedVariant[2]?.trim()
    return variant ? { modelID, variant } : { modelID }
  }

  const spaceVariant = trimmedModelID.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i)
  if (spaceVariant) {
    const modelID = spaceVariant[1]?.trim() ?? ""
    const variant = spaceVariant[2]?.trim().toLowerCase()
    if (variant && KNOWN_VARIANTS.has(variant)) {
      return { modelID, variant }
    }
  }

  return { modelID: trimmedModelID }
}

export function parseModelString(
  model: string,
): { providerID: string; modelID: string; variant?: string } | undefined {
  if (typeof model !== "string") return undefined
  const trimmedModel = model.trim()
  if (!trimmedModel) return undefined

  const { providers, modelID } = splitProvidersAndModel(model)
  if (providers.length === 0) return undefined
  if (!modelID) return undefined

  const parsedModel = parseVariantFromModelID(modelID)
  if (!parsedModel.modelID) return undefined

  const providerID = providers[0]
  return parsedModel.variant
    ? { providerID, modelID: parsedModel.modelID, variant: parsedModel.variant }
    : { providerID, modelID: parsedModel.modelID }
}

/**
 * Split a model string into providers and model ID.
 * Supports pipe syntax: `"cpa|opencode-go/kimi-k2.6"` → providers: [`cpa`, `opencode-go`], modelID: `kimi-k2.6`
 * Falls back to existing format: `"cpa/kimi-k2.6"` → providers: [`cpa`], modelID: `kimi-k2.6`
 * No slash: `"model-name"` → providers: [], modelID: `model-name`
 */
export function splitProvidersAndModel(
  s: string,
): { providers: string[]; modelID: string } {
  const trimmed = s.trim()
  if (!trimmed) return { providers: [], modelID: "" }

  const hasPipe = trimmed.includes("|")
  const slashIndex = hasPipe ? trimmed.lastIndexOf("/") : trimmed.indexOf("/")


  if (slashIndex === -1) {
    return { providers: [], modelID: trimmed }
  }

  const providersPart = trimmed.slice(0, slashIndex)
  const modelID = trimmed.slice(slashIndex + 1).trim()
  const providers = hasPipe
    ? providersPart.split("|").map(p => p.trim()).filter(Boolean)
    : [providersPart.trim()].filter(Boolean)

  return { providers, modelID }
}
