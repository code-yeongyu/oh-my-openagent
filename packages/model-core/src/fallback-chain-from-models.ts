import type { FallbackEntry } from "./model-requirements"
import type { FallbackModelObject } from "./fallback-model-object"
import { normalizeFallbackModels } from "./model-resolver"
import { parseModelRoute, parseVariantFromModelID } from "./model-string-parser"

export function parseFallbackModelEntry(
  model: string,
  contextProviderID: string | undefined,
  defaultProviderID = "opencode",
): FallbackEntry | undefined {
  if (typeof model !== "string") return undefined
  const trimmed = model.trim()
  if (!trimmed) return undefined

  const explicitRoute = parseModelRoute(trimmed)
  if (explicitRoute) {
    return {
      providers: explicitRoute.providers,
      model: explicitRoute.modelID,
      variant: explicitRoute.variant,
    }
  }

  if (trimmed.includes("/")) return undefined

  const providerID = contextProviderID?.trim() || defaultProviderID
  if (!providerID) return undefined

  const parsed = parseVariantFromModelID(trimmed)
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
    .map((entry) => {
      if (typeof entry === "string") {
        return parseFallbackModelEntry(entry, contextProviderID, defaultProviderID)
      }
      return parseFallbackModelObjectEntry(entry, contextProviderID, defaultProviderID)
    })
    .filter((entry): entry is FallbackEntry => entry !== undefined)

  if (parsed.length === 0) return undefined
  return parsed
}
