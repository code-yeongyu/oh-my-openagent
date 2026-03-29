import type { FallbackModelObject } from "../config/schema/fallback-models"
import { normalizeModel } from "./model-normalization"
import { resolveExplicitModel } from "./explicit-model-resolution"
import { parseModelString, parseVariantFromModelID } from "./model-string-parser"
import { fuzzyMatchModel } from "./model-availability"

export function resolveExplicitFallbackModel(
  fallbackModel: string,
  input: { availableModels: Set<string> },
): { model: string; variant?: string } | undefined {
  const parsedFallback = parseConfiguredFallbackEntry(fallbackModel)
  if (!parsedFallback || parsedFallback.isObjectEntry) {
    return undefined
  }

  return resolveParsedStringFallback(parsedFallback, input)
}

type ParsedConfiguredFallbackEntry = {
  original: string
  baseModel: string
  providerHint?: string[]
  variant?: string
  isObjectEntry: boolean
}

function parseConfiguredFallbackEntry(
  fallbackModel: string | FallbackModelObject,
): ParsedConfiguredFallbackEntry | undefined {
  const original = typeof fallbackModel === "string" ? fallbackModel : fallbackModel.model
  const normalizedFallback = normalizeModel(original)
  if (!normalizedFallback) {
    return undefined
  }

  const parsedFullModel = parseModelString(normalizedFallback)
  if (parsedFullModel) {
    return {
      original: normalizedFallback,
      baseModel: `${parsedFullModel.providerID}/${parsedFullModel.modelID}`,
      providerHint: [parsedFullModel.providerID],
      variant: typeof fallbackModel === "string"
        ? parsedFullModel.variant
        : fallbackModel.variant ?? parsedFullModel.variant,
      isObjectEntry: typeof fallbackModel !== "string",
    }
  }

  const parsedModel = parseVariantFromModelID(normalizedFallback)
  if (!parsedModel.modelID) {
    return undefined
  }

  return {
    original: normalizedFallback,
    baseModel: parsedModel.modelID,
    variant: typeof fallbackModel === "string"
      ? parsedModel.variant
      : fallbackModel.variant ?? parsedModel.variant,
    isObjectEntry: typeof fallbackModel !== "string",
  }
}

function resolveParsedStringFallback(
  parsedFallback: ParsedConfiguredFallbackEntry,
  input: { availableModels: Set<string> },
): { model: string; variant?: string } | undefined {
  const resolvedModel = resolveExplicitModel(parsedFallback.baseModel, input)
  if (!resolvedModel) {
    return undefined
  }

  return parsedFallback.variant
    ? { model: resolvedModel, variant: parsedFallback.variant }
    : { model: resolvedModel }
}

export function resolveConfiguredFallbackEntry(
  fallbackModel: string | FallbackModelObject,
  input: {
    availableModels: Set<string>
    connectedProviders?: string[] | null
    preserveObjectVariant?: boolean
  },
): { model: string; original: string; variant?: string } | undefined {
  const parsedFallback = parseConfiguredFallbackEntry(fallbackModel)
  if (!parsedFallback) {
    return undefined
  }

  const includeVariant = !parsedFallback.isObjectEntry
    || input.preserveObjectVariant !== false

  if (input.availableModels.size === 0) {
    const connectedProviders = input.connectedProviders
    if (
      connectedProviders
      && parsedFallback.providerHint
      && !parsedFallback.providerHint.some((provider) => connectedProviders.includes(provider))
    ) {
      return undefined
    }

    return includeVariant && parsedFallback.variant
      ? { model: parsedFallback.baseModel, original: parsedFallback.original, variant: parsedFallback.variant }
      : { model: parsedFallback.baseModel, original: parsedFallback.original }
  }

  if (!parsedFallback.isObjectEntry) {
    const resolvedFallback = resolveParsedStringFallback(parsedFallback, {
      availableModels: input.availableModels,
    })
    if (!resolvedFallback) {
      return undefined
    }

    return resolvedFallback.variant
      ? { model: resolvedFallback.model, original: parsedFallback.original, variant: resolvedFallback.variant }
      : { model: resolvedFallback.model, original: parsedFallback.original }
  }

  const match = fuzzyMatchModel(
    parsedFallback.baseModel,
    input.availableModels,
    parsedFallback.providerHint,
  )
  if (!match) {
    return undefined
  }

  return includeVariant && parsedFallback.variant
    ? { model: match, original: parsedFallback.original, variant: parsedFallback.variant }
    : { model: match, original: parsedFallback.original }
}
