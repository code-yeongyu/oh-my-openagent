import { parseModelString } from "./model-string-parser"

interface RuntimeFallbackModelRecord {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: unknown
}

function isRuntimeFallbackModelRecord(model: unknown): model is RuntimeFallbackModelRecord {
  if (typeof model !== "object" || model === null) return false

  return (
    "providerID" in model &&
    "modelID" in model &&
    typeof model.providerID === "string" &&
    typeof model.modelID === "string"
  )
}

export function stringifyRuntimeFallbackModel(model: unknown): string | undefined {
  if (typeof model === "string") return model

  if (!isRuntimeFallbackModelRecord(model)) return undefined

  const providerID = model.providerID.trim()
  const trimmedModelID = model.modelID.trim()
  const trimmedVariant = typeof model.variant === "string" ? model.variant.trim() : undefined

  if (!providerID || !trimmedModelID) return undefined

  const baseModel = `${providerID}/${trimmedModelID}`
  return trimmedVariant ? `${baseModel}(${trimmedVariant})` : baseModel
}

export function stringifyRuntimeFallbackModelWithVariant(model: unknown, variant: unknown): string | undefined {
  const baseModel = stringifyRuntimeFallbackModel(model)
  const fallbackVariant = typeof variant === "string" ? variant.trim() : undefined
  if (!baseModel || !fallbackVariant) return baseModel

  const parsed = parseModelString(baseModel)
  if (!parsed?.providerID || !parsed.modelID || parsed.variant) return baseModel

  return `${parsed.providerID}/${parsed.modelID}(${fallbackVariant})`
}

function canonicalizeRuntimeFallbackModelID(modelID: string): string {
  const loweredModelID = modelID.toLowerCase()
  const dottedModelID = loweredModelID.replace(/\./g, "-")

  if (
    dottedModelID.startsWith("claude-opus-") ||
    dottedModelID.startsWith("claude-sonnet-") ||
    dottedModelID.startsWith("claude-haiku-")
  ) {
    return dottedModelID
      .replace(/-thinking$/i, "")
      .replace(/-max$/i, "")
      .replace(/-high$/i, "")
  }

  return dottedModelID
}

function canonicalizeRuntimeFallbackProviderFamily(providerID: string, modelID: string): string {
  const canonicalModelID = canonicalizeRuntimeFallbackModelID(modelID)

  if (
    canonicalModelID.startsWith("claude-opus-") ||
    canonicalModelID.startsWith("claude-sonnet-") ||
    canonicalModelID.startsWith("claude-haiku-")
  ) {
    return "anthropic-compatible-claude"
  }

  return providerID.toLowerCase()
}

function parseCanonicalRuntimeFallbackModel(model: string): { providerID: string; modelID: string } | undefined {
  const parsed = parseModelString(model)
  if (!parsed?.providerID || !parsed.modelID) return undefined

  const canonicalModelID = canonicalizeRuntimeFallbackModelID(parsed.modelID)
  const variant = parsed.variant?.toLowerCase()

  return {
    providerID: canonicalizeRuntimeFallbackProviderFamily(parsed.providerID, parsed.modelID),
    modelID: variant ? `${canonicalModelID}::${variant}` : canonicalModelID,
  }
}

export function areRuntimeFallbackModelsEquivalent(candidate: string | undefined, current: string | undefined): boolean {
  if (!candidate || !current) return false

  const parsedCandidate = parseCanonicalRuntimeFallbackModel(candidate)
  const parsedCurrent = parseCanonicalRuntimeFallbackModel(current)

  if (!parsedCandidate || !parsedCurrent) {
    return candidate.toLowerCase() === current.toLowerCase()
  }

  return (
    parsedCandidate.providerID === parsedCurrent.providerID &&
    parsedCandidate.modelID === parsedCurrent.modelID
  )
}
