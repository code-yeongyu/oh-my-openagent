import { splitReasoningSuffix } from "./reasoning-level"

export function parseVariantFromModelID(
  rawModelID: string,
  options?: { readonly allowMaxSuffix?: boolean },
): { modelID: string; variant?: string } {
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

  const suffixedModel = splitReasoningSuffix(trimmedModelID, options)
  if (suffixedModel.level) {
    return { modelID: suffixedModel.base, variant: suffixedModel.level }
  }

  const spaceVariant = trimmedModelID.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i)
  if (spaceVariant) {
    const modelID = spaceVariant[1]?.trim() ?? ""
    const variant = spaceVariant[2]?.trim().toLowerCase()
    if (variant) {
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

  const separatorIndex = trimmedModel.indexOf("/")
  if (separatorIndex === -1) {
    return undefined
  }

  const providerID = trimmedModel.slice(0, separatorIndex).trim()
  const rawModelID = trimmedModel.slice(separatorIndex + 1).trim()
  if (!providerID || !rawModelID) {
    return undefined
  }

  const parsedModel = parseVariantFromModelID(rawModelID, { allowMaxSuffix: true })
  if (!parsedModel.modelID) {
    return undefined
  }

  return parsedModel.variant
    ? { providerID, modelID: parsedModel.modelID, variant: parsedModel.variant }
    : { providerID, modelID: parsedModel.modelID }
}
