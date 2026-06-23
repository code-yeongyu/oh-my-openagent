/**
 * V0.10.3 model capability resolver. Resolves a base model id to upstream body
 * fields (model_type, thinking_enabled, search_enabled) using:
 *   1. Base model defaults from MODEL_CAPABILITY_MATRIX.
 *   2. Optional extra_body.thinking and extra_body.search boolean overrides.
 *
 * OpenCode forwards provider model "options" + active variant ("variants[X]")
 * as top-level body fields named `thinking` and `search` (matching the existing
 * ds2api convention).
 *
 * Capability truth table (verified live 2026-06-21 with web bundle commit
 * 1300ef9f7, x-app-version 2.0.0):
 *   - default (flash):  thinking ✓  | search ✓        (all 4 combos)
 *   - expert  (pro):    thinking ✓  | search ✗ (server silently no-ops; gated)
 *   - vision:           thinking ✓  | search ✗ (server returns backend error)
 *
 * Resolver throws CapabilityViolationError with code "search_unsupported" or
 * "thinking_unsupported" so the route layer returns 400 before pool acquire.
 */
export type ModelType = "default" | "expert" | "vision"

export type BaseModel =
  | "deepseek-v4-pro"
  | "deepseek-v4-flash"
  | "deepseek-v4-vision"

export type ResolvedCapabilities = {
  baseModel: BaseModel
  modelType: ModelType
  thinkingEnabled: boolean
  searchEnabled: boolean
  canonicalModel: string
}

type CapabilityDefaults = {
  modelType: ModelType
  thinkingDefault: boolean
  searchDefault: boolean
  thinkingAllowed: boolean
  searchAllowed: boolean
}

export const MODEL_CAPABILITY_MATRIX: Readonly<
  Record<BaseModel, CapabilityDefaults>
> = Object.freeze({
  "deepseek-v4-pro": Object.freeze({
    modelType: "expert",
    thinkingDefault: true,
    searchDefault: false,
    thinkingAllowed: true,
    searchAllowed: false,
  }),
  "deepseek-v4-flash": Object.freeze({
    modelType: "default",
    thinkingDefault: false,
    searchDefault: false,
    thinkingAllowed: true,
    searchAllowed: true,
  }),
  "deepseek-v4-vision": Object.freeze({
    modelType: "vision",
    thinkingDefault: false,
    searchDefault: false,
    thinkingAllowed: true,
    searchAllowed: false,
  }),
})

export const SUPPORTED_MODEL_IDS: ReadonlyArray<string> = Object.freeze([
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-v4-vision",
])

export class CapabilityViolationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "CapabilityViolationError"
    this.code = code
  }
}

export function isSupportedModel(modelId: string): boolean {
  return SUPPORTED_MODEL_IDS.includes(modelId)
}

function isBaseModel(value: string): value is BaseModel {
  return (
    value === "deepseek-v4-pro" ||
    value === "deepseek-v4-flash" ||
    value === "deepseek-v4-vision"
  )
}

function readBoolean(extra: unknown, key: string): boolean | undefined {
  if (extra === null || typeof extra !== "object") return undefined
  const value = (extra as Record<string, unknown>)[key]
  return typeof value === "boolean" ? value : undefined
}

function readOverride(
  extra: unknown,
  primary: string,
  legacy: string,
): boolean | undefined {
  const v = readBoolean(extra, primary)
  if (v !== undefined) return v
  return readBoolean(extra, legacy)
}

export function resolveCapabilities(
  modelId: string,
  extraBody?: unknown,
): ResolvedCapabilities {
  if (!isBaseModel(modelId)) {
    throw new Error(
      `Unknown model: ${modelId}. Supported: ${SUPPORTED_MODEL_IDS.join(", ")}`,
    )
  }
  const caps = MODEL_CAPABILITY_MATRIX[modelId]
  const extraThinking = readOverride(extraBody, "thinking", "thinking_enabled")
  const extraSearch = readOverride(extraBody, "search", "search_enabled")
  const thinkingEnabled =
    extraThinking === undefined ? caps.thinkingDefault : extraThinking
  const searchEnabled =
    extraSearch === undefined ? caps.searchDefault : extraSearch
  if (thinkingEnabled && !caps.thinkingAllowed) {
    throw new CapabilityViolationError(
      "thinking_unsupported",
      `Model does not support thinking=true (model=${modelId})`,
    )
  }
  if (searchEnabled && !caps.searchAllowed) {
    throw new CapabilityViolationError(
      "search_unsupported",
      `Model does not support search=true (model=${modelId})`,
    )
  }
  return {
    baseModel: modelId,
    modelType: caps.modelType,
    thinkingEnabled,
    searchEnabled,
    canonicalModel: modelId,
  }
}
