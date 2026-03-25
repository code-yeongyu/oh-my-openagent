import bundledModelCapabilitiesSnapshotJson from "../generated/model-capabilities.generated.json"
import { findProviderModelMetadata, type ModelMetadata } from "./connected-providers-cache"
import { detectHeuristicModelFamily } from "./model-capability-heuristics"

export type ModelCapabilitiesSnapshotEntry = {
  id: string
  family?: string
  reasoning?: boolean
  temperature?: boolean
  toolCall?: boolean
  modalities?: {
    input?: string[]
    output?: string[]
  }
  limit?: {
    context?: number
    input?: number
    output?: number
  }
}

export type ModelCapabilitiesSnapshot = {
  generatedAt: string
  sourceUrl: string
  models: Record<string, ModelCapabilitiesSnapshotEntry>
}

export type ModelCapabilities = {
  requestedModelID: string
  canonicalModelID: string
  family?: string
  variants?: string[]
  reasoningEfforts?: string[]
  reasoning?: boolean
  supportsThinking?: boolean
  supportsTemperature?: boolean
  supportsTopP?: boolean
  maxOutputTokens?: number
  toolCall?: boolean
  modalities?: {
    input?: string[]
    output?: string[]
  }
}

type GetModelCapabilitiesInput = {
  providerID: string
  modelID: string
  runtimeModel?: ModelMetadata | Record<string, unknown>
  runtimeSnapshot?: ModelCapabilitiesSnapshot
  bundledSnapshot?: ModelCapabilitiesSnapshot
}

type ModelCapabilityOverride = {
  canonicalModelID?: string
  variants?: string[]
  reasoningEfforts?: string[]
  supportsThinking?: boolean
  supportsTemperature?: boolean
  supportsTopP?: boolean
}

const MODEL_ID_OVERRIDES: Record<string, ModelCapabilityOverride> = {
  "claude-opus-4-6-thinking": { canonicalModelID: "claude-opus-4-6" },
  "claude-sonnet-4-6-thinking": { canonicalModelID: "claude-sonnet-4-6" },
  "claude-opus-4-5-thinking": { canonicalModelID: "claude-opus-4-5-20251101" },
  "gpt-5.3-codex-spark": { canonicalModelID: "gpt-5.3-codex" },
  "gemini-3.1-pro-high": { canonicalModelID: "gemini-3.1-pro-preview" },
  "gemini-3.1-pro-low": { canonicalModelID: "gemini-3.1-pro-preview" },
  "gemini-3-pro-high": { canonicalModelID: "gemini-3-pro-preview" },
  "gemini-3-pro-low": { canonicalModelID: "gemini-3-pro-preview" },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeLookupModelID(modelID: string): string {
  return modelID.trim().toLowerCase()
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const strings = value.filter((item): item is string => typeof item === "string")
  return strings.length > 0 ? strings : undefined
}

function normalizeVariantKeys(value: unknown): string[] | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const variants = Object.keys(value).map((variant) => variant.toLowerCase())
  return variants.length > 0 ? variants : undefined
}

function normalizeModalities(value: unknown): ModelCapabilities["modalities"] | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const input = readStringArray(value.input)
  const output = readStringArray(value.output)

  if (!input && !output) {
    return undefined
  }

  return {
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
  }
}

function normalizeSnapshot(snapshot: ModelCapabilitiesSnapshot | typeof bundledModelCapabilitiesSnapshotJson): ModelCapabilitiesSnapshot {
  return snapshot as ModelCapabilitiesSnapshot
}

function getCanonicalModelID(modelID: string): string {
  const normalizedModelID = normalizeLookupModelID(modelID)
  const override = MODEL_ID_OVERRIDES[normalizedModelID]
  if (override?.canonicalModelID) {
    return override.canonicalModelID
  }

  if (normalizedModelID.startsWith("claude-") && normalizedModelID.endsWith("-thinking")) {
    return normalizedModelID.replace(/-thinking$/i, "")
  }

  return normalizedModelID
}

function getOverride(modelID: string): ModelCapabilityOverride | undefined {
  return MODEL_ID_OVERRIDES[normalizeLookupModelID(modelID)]
}

function readRuntimeModelLimitOutput(runtimeModel: Record<string, unknown> | undefined): number | undefined {
  if (!runtimeModel) {
    return undefined
  }

  const limit = runtimeModel.limit
  if (!isRecord(limit)) {
    return undefined
  }

  return readNumber(limit.output)
}

function readRuntimeModelBoolean(runtimeModel: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  if (!runtimeModel) {
    return undefined
  }

  for (const key of keys) {
    const value = runtimeModel[key]
    if (typeof value === "boolean") {
      return value
    }
  }

  return undefined
}

function readRuntimeModel(runtimeModel: ModelMetadata | Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return isRecord(runtimeModel) ? runtimeModel : undefined
}

const bundledModelCapabilitiesSnapshot = normalizeSnapshot(bundledModelCapabilitiesSnapshotJson)

export function getBundledModelCapabilitiesSnapshot(): ModelCapabilitiesSnapshot {
  return bundledModelCapabilitiesSnapshot
}

export function getModelCapabilities(input: GetModelCapabilitiesInput): ModelCapabilities {
  const requestedModelID = normalizeLookupModelID(input.modelID)
  const canonicalModelID = getCanonicalModelID(input.modelID)
  const override = getOverride(input.modelID)
  const runtimeModel = readRuntimeModel(
    input.runtimeModel ?? findProviderModelMetadata(input.providerID, input.modelID),
  )
  const runtimeSnapshot = input.runtimeSnapshot
  const bundledSnapshot = input.bundledSnapshot ?? bundledModelCapabilitiesSnapshot
  const snapshotEntry = runtimeSnapshot?.models?.[canonicalModelID] ?? bundledSnapshot.models[canonicalModelID]
  const heuristicFamily = detectHeuristicModelFamily(canonicalModelID)
  const runtimeVariants = normalizeVariantKeys(runtimeModel?.variants)

  return {
    requestedModelID,
    canonicalModelID,
    family: snapshotEntry?.family ?? heuristicFamily?.family,
    variants: runtimeVariants ?? override?.variants ?? heuristicFamily?.variants,
    reasoningEfforts: override?.reasoningEfforts ?? heuristicFamily?.reasoningEfforts,
    reasoning: readRuntimeModelBoolean(runtimeModel, ["reasoning"]) ?? snapshotEntry?.reasoning,
    supportsThinking:
      override?.supportsThinking
      ?? heuristicFamily?.supportsThinking
      ?? readRuntimeModelBoolean(runtimeModel, ["reasoning"])
      ?? snapshotEntry?.reasoning,
    supportsTemperature:
      readRuntimeModelBoolean(runtimeModel, ["temperature"])
      ?? override?.supportsTemperature
      ?? snapshotEntry?.temperature,
    supportsTopP:
      readRuntimeModelBoolean(runtimeModel, ["topP", "top_p"])
      ?? override?.supportsTopP,
    maxOutputTokens:
      readRuntimeModelLimitOutput(runtimeModel)
      ?? snapshotEntry?.limit?.output,
    toolCall:
      readRuntimeModelBoolean(runtimeModel, ["toolCall", "tool_call"])
      ?? snapshotEntry?.toolCall,
    modalities:
      normalizeModalities(runtimeModel?.modalities)
      ?? snapshotEntry?.modalities,
  }
}
