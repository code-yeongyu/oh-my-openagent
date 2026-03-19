const KNOWN_VARIANTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "none",
  "auto",
  "thinking",
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

  return { modelID: trimmedModelID }
}

export function parseModelString(
  model: string,
): { providerID: string; modelID: string; variant?: string } | undefined {
  const trimmedModel = model.trim()
  if (!trimmedModel) return undefined

  const parts = trimmedModel.split("/")
  if (parts.length < 2) {
    return undefined
  }

  const providerID = parts[0]?.trim()
  const rawModelID = parts.slice(1).join("/").trim()
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
