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
  "cloud",
])

export function parseVariantFromModelID(rawModelID: string): { modelID: string; variant?: string } {
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

  // Handle Ollama-style colon-separated variants: "model:tag" (e.g., "glm-5.1:cloud", "kimi-k2.5:thinking")
  // Only matches when what follows the last colon is a simple tag (letters, digits, dots, underscores, hyphens)
  const colonVariant = trimmedModelID.match(/^(.+):([a-z][a-z0-9._-]*)$/i)
  if (colonVariant) {
    const modelID = colonVariant[1]?.trim() ?? ""
    const variant = colonVariant[2]?.trim().toLowerCase()
    if (variant && KNOWN_VARIANTS.has(variant)) {
      return { modelID, variant }
    }
    // If the suffix after colon is not a recognized variant, keep it as part of the model ID
    // (e.g., "kimi-k2.5:cloud" where ":cloud" IS now a known variant → strips to "kimi-k2.5")
    // (e.g., "model:sometag" where ":sometag" is NOT known → stays as "model:sometag")
  }

  return { modelID: trimmedModelID }
}

export function parseModelString(
  model: string,
): { providerID: string; modelID: string; variant?: string } | undefined {
  const trimmedModel = model.trim()
  if (!trimmedModel) return undefined

  const separatorIndex = trimmedModel.indexOf("/")
  if (separatorIndex === -1) {
    return undefined
  }

  const providerID = trimmedModel.slice(0, separatorIndex).trim()
  const rawModelID = trimmedModel.slice(separatorIndex + 1).trim()
  if (!providerID || !rawModelID) {
    return undefined
  }

  const parsedModel = parseVariantFromModelID(rawModelID)
  if (!parsedModel.modelID) {
    return undefined
  }

  return parsedModel.variant
    ? { providerID, modelID: parsedModel.modelID, variant: parsedModel.variant }
    : { providerID, modelID: parsedModel.modelID }
}
