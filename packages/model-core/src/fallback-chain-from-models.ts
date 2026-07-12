import { splitProvidersAndModel, parseVariantFromModelID } from "./model-string-parser"
import type { FallbackEntry } from "./model-requirements"
import type { FallbackModelObject } from "./fallback-model-object"
import { normalizeFallbackModels } from "./model-resolver"
import { KNOWN_VARIANTS } from "./known-variants"

function parseVariantFromModel(rawModel: string): { modelID: string; variant?: string } {
  if (typeof rawModel !== "string") {
    return { modelID: "" }
  }
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
  contextProviderID: string | undefined,
  defaultProviderID = "opencode",
): FallbackEntry | undefined {
  if (typeof model !== "string") return undefined
  const trimmed = model.trim()
  if (!trimmed) return undefined

  const { providers, modelID } = splitProvidersAndModel(trimmed)
  const providerID = providers.length > 0
    ? providers[0]
    : (contextProviderID?.trim() || defaultProviderID)
  const rawModelID = modelID || trimmed
  if (!providerID || !rawModelID) return undefined

  const parsed = parseVariantFromModelID(rawModelID)
  if (!parsed.modelID) return undefined

  return {
    providers: [providerID],
    model: parsed.modelID,
    variant: parsed.variant,
  }
}

export function parseFallbackModelObjectEntry(
  obj: FallbackModelObject,
  contextProviderID: string | undefined,
  defaultProviderID = "opencode",
): FallbackEntry | undefined {
  const base = parseFallbackModelEntry(obj.model, contextProviderID, defaultProviderID)
  if (!base) return undefined

  return {
    ...base,
    variant: obj.variant ?? base.variant,
    reasoningEffort: obj.reasoningEffort,
    temperature: obj.temperature,
    top_p: obj.top_p,
    maxTokens: obj.maxTokens,
    thinking: obj.thinking,
}
}
/**
 * Find the most specific FallbackEntry whose `provider/model` is a prefix of
 * the resolved `provider/modelID`.  Longest match wins so that e.g.
 * `openai/gpt-5.4-preview` picks the entry for `openai/gpt-5.4-preview` over
 * the shorter `openai/gpt-5.4`.
 */
export function findMostSpecificFallbackEntry(
  providerID: string,
  modelID: string,
  chain: FallbackEntry[],
): FallbackEntry | undefined {
  const resolved = `${providerID}/${modelID}`.toLowerCase()

  // Collect entries whose provider/model is a prefix of the resolved model,
  // together with the length of the matching prefix (longest match wins).
  const matches: { entry: FallbackEntry; matchLen: number }[] = []
  for (const entry of chain) {
    for (const p of entry.providers) {
      const candidate = `${p}/${entry.model}`.toLowerCase()
      if (resolved.startsWith(candidate)) {
        matches.push({ entry, matchLen: candidate.length })
        break // one match per entry is enough
      }
    }
  }

  if (matches.length === 0) return undefined
  matches.sort((a, b) => b.matchLen - a.matchLen)
  return matches[0].entry
}

export function buildFallbackChainFromModels(
  fallbackModels: string | (string | FallbackModelObject)[] | undefined,
  contextProviderID: string | undefined,
  defaultProviderID = "opencode",
): FallbackEntry[] | undefined {
  const normalized = normalizeFallbackModels(fallbackModels)
  if (!normalized || normalized.length === 0) return undefined

  const parsed = normalized
    .flatMap((entry) => {
      if (typeof entry === "string") {
        const { providers, modelID } = splitProvidersAndModel(entry)
        if (providers.length > 1) {
          const parsedVariant = parseVariantFromModelID(modelID)
          if (!parsedVariant.modelID) return []
          return providers.map((p) =>
            ({ providers: [p], model: parsedVariant.modelID, variant: parsedVariant.variant } as FallbackEntry)
          )
        }
        return parseFallbackModelEntry(entry, contextProviderID, defaultProviderID) || []
      }
      const { providers, modelID } = splitProvidersAndModel(entry.model)
      if (providers.length > 1) {
        const parsedVariant = parseVariantFromModelID(modelID)
        if (!parsedVariant.modelID) return []
        return providers.map((p) => ({
          providers: [p],
          model: parsedVariant.modelID,
          variant: entry.variant ?? parsedVariant.variant,
          reasoningEffort: entry.reasoningEffort,
          temperature: entry.temperature,
          top_p: entry.top_p,
          maxTokens: entry.maxTokens,
          thinking: entry.thinking,
        } as FallbackEntry))
      }
      return parseFallbackModelObjectEntry(entry, contextProviderID, defaultProviderID) || []
    })

  if (parsed.length === 0) return undefined
  return parsed
}
