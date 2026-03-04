import type { FallbackEntry } from "./model-requirements"
import { normalizeFallbackModels } from "./model-resolver"

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

function parseVariantFromModel(rawModel: string): { modelID: string; variant?: string } {
  const trimmedModel = rawModel.trim()
  if (!trimmedModel) {
    return { modelID: "" }
  }

  const parenthesizedVariant = trimmedModel.match(/^(.*)\(([^()]+)\)\s*$/)
  if (parenthesizedVariant) {
    const modelID = parenthesizedVariant[1]?.trim() ?? ""
    const variant = parenthesizedVariant[2]?.trim()
    return variant ? { modelID, variant } : { modelID }
  }

  const spaceVariant = trimmedModel.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i)
  if (spaceVariant) {
    const modelID = spaceVariant[1]?.trim() ?? ""
    const variant = spaceVariant[2]?.trim().toLowerCase()
    if (variant && KNOWN_VARIANTS.has(variant)) {
      return { modelID, variant }
    }
  }

  return { modelID: trimmedModel }
}

export function parseFallbackModelEntry(
  model: string,
  defaultProviderID: string,
): FallbackEntry | undefined {
  const trimmed = model.trim()
  if (!trimmed) return undefined

  const parts = trimmed.split("/")
  const providerID = parts.length >= 2 ? parts[0].trim() : defaultProviderID
  const rawModelID = parts.length >= 2 ? parts.slice(1).join("/").trim() : trimmed
  if (!providerID || !rawModelID) return undefined

  const parsed = parseVariantFromModel(rawModelID)
  if (!parsed.modelID) return undefined

  return {
    providers: [providerID],
    model: parsed.modelID,
    variant: parsed.variant,
  }
}

export function buildFallbackChainFromModels(
  fallbackModels: string | string[] | undefined,
  defaultProviderID: string,
): FallbackEntry[] | undefined {
  const normalized = normalizeFallbackModels(fallbackModels)
  if (!normalized || normalized.length === 0) return undefined

  const parsed = normalized
    .map((model) => parseFallbackModelEntry(model, defaultProviderID))
    .filter((entry): entry is FallbackEntry => entry !== undefined)

  if (parsed.length === 0) return undefined
  return parsed
}
