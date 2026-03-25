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
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
  const arrayVariants = readStringArray(value)
  if (arrayVariants) {
    return arrayVariants.map((variant) => variant.toLowerCase())
  }

  if (!isRecord(value)) {
    return undefined
  }

  const variants = Object.keys(value).map((variant) => variant.toLowerCase())
  return variants.length > 0 ? variants : undefined
}

function readModalityKeys(value: unknown): string[] | undefined {
  const stringArray = readStringArray(value)
  if (stringArray) {
    return stringArray.map((entry) => entry.toLowerCase())
  }

  if (!isRecord(value)) {
    return undefined
  }

  const enabled = Object.entries(value)
    .filter(([, supported]) => supported === true)
    .map(([modality]) => modality.toLowerCase())

  return enabled.length > 0 ? enabled : undefined
}

function normalizeModalities(value: unknown): ModelCapabilities["modalities"] | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const input = readModalityKeys(value.input)
  const output = readModalityKeys(value.output)

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

function readRuntimeModelCapabilities(runtimeModel: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return isRecord(runtimeModel?.capabilities) ? runtimeModel.capabilities : undefined
}

function readRuntimeModelLimitOutput(runtimeModel: Record<string, unknown> | undefined): number | undefined {
  if (!runtimeModel) {
    return undefined
  }

  const limit = isRecord(runtimeModel.limit)
    ? runtimeModel.limit
    : readRuntimeModelCapabilities(runtimeModel)?.limit
  if (!isRecord(limit)) {
    return undefined
  }

  return readNumber(limit.output)
}

function readRuntimeModelBoolean(runtimeModel: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  if (!runtimeModel) {
    return undefined
  }

  const runtimeCapabilities = readRuntimeModelCapabilities(runtimeModel)

  for (const key of keys) {
    const value = runtimeModel[key]
    if (typeof value === "boolean") {
      return value
    }

    const capabilityValue = runtimeCapabilities?.[key]
    if (typeof capabilityValue === "boolean") {
      return capabilityValue
    }
  }

  return undefined
}

function readRuntimeModelModalities(runtimeModel: Record<string, unknown> | undefined): ModelCapabilities["modalities"] | undefined {
  if (!runtimeModel) {
    return undefined
  }

  const rootModalities = normalizeModalities(runtimeModel.modalities)
  if (rootModalities) {
    return rootModalities
  }

  const runtimeCapabilities = readRuntimeModelCapabilities(runtimeModel)
  if (!runtimeCapabilities) {
    return undefined
  }

  const nestedModalities = normalizeModalities(runtimeCapabilities.modalities)
  if (nestedModalities) {
    return nestedModalities
  }

  const capabilityModalities = normalizeModalities(runtimeCapabilities)
  if (capabilityModalities) {
    return capabilityModalities
  }

  return undefined
}

function readRuntimeModelVariants(runtimeModel: Record<string, unknown> | undefined): string[] | undefined {
  if (!runtimeModel) {
    return undefined
  }

  const rootVariants = normalizeVariantKeys(runtimeModel.variants)
  if (rootVariants) {
    return rootVariants
  }

  const runtimeCapabilities = readRuntimeModelCapabilities(runtimeModel)
  if (!runtimeCapabilities) {
    return undefined
  }

  return normalizeVariantKeys(runtimeCapabilities.variants)
}

function readRuntimeModelTopPSupport(runtimeModel: Record<string, unknown> | undefined): boolean | undefined {
  return readRuntimeModelBoolean(runtimeModel, ["topP", "top_p"])
}

function readRuntimeModelToolCallSupport(runtimeModel: Record<string, unknown> | undefined): boolean | undefined {
  return readRuntimeModelBoolean(runtimeModel, ["toolCall", "tool_call", "toolcall"])
}

function readRuntimeModelReasoningSupport(runtimeModel: Record<string, unknown> | undefined): boolean | undefined {
  return readRuntimeModelBoolean(runtimeModel, ["reasoning"])
}

function readRuntimeModelTemperatureSupport(runtimeModel: Record<string, unknown> | undefined): boolean | undefined {
  return readRuntimeModelBoolean(runtimeModel, ["temperature"])
}

function readRuntimeModelThinkingSupport(runtimeModel: Record<string, unknown> | undefined): boolean | undefined {
  const capabilityValue = readRuntimeModelReasoningSupport(runtimeModel)
  if (capabilityValue !== undefined) {
    return capabilityValue
  }

  const rootThinkingSupport = readRuntimeModelBoolean(runtimeModel, ["thinking", "supportsThinking"])
  if (rootThinkingSupport !== undefined) {
    return rootThinkingSupport
  }

  const runtimeCapabilities = readRuntimeModelCapabilities(runtimeModel)
  if (!runtimeCapabilities) {
    return undefined
  }

  for (const key of ["thinking", "supportsThinking"] as const) {
    const value = runtimeCapabilities[key]
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
  const runtimeVariants = readRuntimeModelVariants(runtimeModel)

  return {
    requestedModelID,
    canonicalModelID,
    family: snapshotEntry?.family ?? heuristicFamily?.family,
    variants: runtimeVariants ?? override?.variants ?? heuristicFamily?.variants,
    reasoningEfforts: override?.reasoningEfforts ?? heuristicFamily?.reasoningEfforts,
    reasoning: readRuntimeModelReasoningSupport(runtimeModel) ?? snapshotEntry?.reasoning,
    supportsThinking:
      override?.supportsThinking
      ?? heuristicFamily?.supportsThinking
      ?? readRuntimeModelThinkingSupport(runtimeModel)
      ?? snapshotEntry?.reasoning,
    supportsTemperature:
      readRuntimeModelTemperatureSupport(runtimeModel)
      ?? override?.supportsTemperature
      ?? snapshotEntry?.temperature,
    supportsTopP:
      readRuntimeModelTopPSupport(runtimeModel)
      ?? override?.supportsTopP,
    maxOutputTokens:
      readRuntimeModelLimitOutput(runtimeModel)
      ?? snapshotEntry?.limit?.output,
    toolCall:
      readRuntimeModelToolCallSupport(runtimeModel)
      ?? snapshotEntry?.toolCall,
    modalities:
      readRuntimeModelModalities(runtimeModel)
      ?? snapshotEntry?.modalities,
  }
}
