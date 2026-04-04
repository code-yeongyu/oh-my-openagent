import { detectHeuristicModelFamily } from "./model-capability-heuristics"

type CompatibilityField = "variant" | "reasoningEffort" | "temperature" | "topP" | "maxTokens" | "thinking"

type DesiredModelSettings = {
  variant?: string
  reasoningEffort?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  thinking?: Record<string, unknown>
}

type CompatibilityCapabilities = {
  variants?: string[]
  reasoningEfforts?: string[]
  supportsTemperature?: boolean
  supportsTopP?: boolean
  maxOutputTokens?: number
  supportsThinking?: boolean
}

export type ModelSettingsCompatibilityInput = {
  providerID: string
  modelID: string
  desired: DesiredModelSettings
  capabilities?: CompatibilityCapabilities
}

export type ModelSettingsCompatibilityChange = {
  field: CompatibilityField
  from: string
  to?: string
  reason:
    | "unsupported-by-model-family"
    | "unknown-model-family"
    | "unsupported-by-model-metadata"
    | "max-output-limit"
}

export type ModelSettingsCompatibilityResult = {
  variant?: string
  reasoningEffort?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  thinking?: Record<string, unknown>
  changes: ModelSettingsCompatibilityChange[]
}

const VARIANT_LADDER = ["low", "medium", "high", "xhigh", "max"]
const REASONING_LADDER = ["none", "minimal", "low", "medium", "high", "xhigh"]

function downgradeWithinLadder(value: string, allowed: string[], ladder: string[]): string | undefined {
  const requestedIndex = ladder.indexOf(value)
  if (requestedIndex === -1) return undefined

  for (let index = requestedIndex; index >= 0; index -= 1) {
    if (allowed.includes(ladder[index])) {
      return ladder[index]
    }
  }

  return undefined
}

function normalizeCapabilitiesVariants(capabilities: CompatibilityCapabilities | undefined): string[] | undefined {
  if (!capabilities?.variants || capabilities.variants.length === 0) {
    return undefined
  }
  return capabilities.variants.map((v) => v.toLowerCase())
}

function normalizeCapabilitiesReasoningEfforts(capabilities: CompatibilityCapabilities | undefined): string[] | undefined {
  if (!capabilities?.reasoningEfforts || capabilities.reasoningEfforts.length === 0) {
    return undefined
  }
  return capabilities.reasoningEfforts.map((value) => value.toLowerCase())
}

type FieldResolution = { value?: string; reason?: ModelSettingsCompatibilityChange["reason"] }

function resolveField(
  normalized: string,
  familyCaps: string[] | undefined,
  ladder: string[],
  familyKnown: boolean,
  metadataOverride?: string[],
): FieldResolution {
  if (metadataOverride) {
    if (metadataOverride.includes(normalized)) return { value: normalized }
    return {
      value: downgradeWithinLadder(normalized, metadataOverride, ladder),
      reason: "unsupported-by-model-metadata",
    }
  }

  if (familyCaps) {
    if (familyCaps.includes(normalized)) return { value: normalized }
    return {
      value: downgradeWithinLadder(normalized, familyCaps, ladder),
      reason: "unsupported-by-model-family",
    }
  }

  if (familyKnown) {
    return { value: undefined, reason: "unsupported-by-model-family" }
  }

  return { value: undefined, reason: "unknown-model-family" }
}

export function resolveCompatibleModelSettings(
  input: ModelSettingsCompatibilityInput,
): ModelSettingsCompatibilityResult {
  const family = detectHeuristicModelFamily(input.modelID)
  const familyKnown = Boolean(family)
  const changes: ModelSettingsCompatibilityChange[] = []
  const metadataVariants = normalizeCapabilitiesVariants(input.capabilities)
  const metadataReasoningEfforts = normalizeCapabilitiesReasoningEfforts(input.capabilities)

  let variant = input.desired.variant
  if (variant !== undefined) {
    const normalized = variant.toLowerCase()
    const resolved = resolveField(normalized, family?.variants, VARIANT_LADDER, familyKnown, metadataVariants)
    if (resolved.value !== normalized && resolved.reason) {
      changes.push({ field: "variant", from: variant, to: resolved.value, reason: resolved.reason })
    }
    variant = resolved.value
  }

  let reasoningEffort = input.desired.reasoningEffort
  if (reasoningEffort !== undefined) {
    const normalized = reasoningEffort.toLowerCase()
    const resolved = resolveField(normalized, family?.reasoningEfforts, REASONING_LADDER, familyKnown, metadataReasoningEfforts)
    if (resolved.value !== normalized && resolved.reason) {
      changes.push({ field: "reasoningEffort", from: reasoningEffort, to: resolved.value, reason: resolved.reason })
    }
    reasoningEffort = resolved.value
  }

  let temperature = input.desired.temperature
  if (temperature !== undefined && input.capabilities?.supportsTemperature === false) {
    changes.push({
      field: "temperature",
      from: String(temperature),
      to: undefined,
      reason: "unsupported-by-model-metadata",
    })
    temperature = undefined
  }

  let topP = input.desired.topP
  if (topP !== undefined && input.capabilities?.supportsTopP === false) {
    changes.push({
      field: "topP",
      from: String(topP),
      to: undefined,
      reason: "unsupported-by-model-metadata",
    })
    topP = undefined
  }

  let maxTokens = input.desired.maxTokens
  if (
    maxTokens !== undefined &&
    input.capabilities?.maxOutputTokens !== undefined &&
    maxTokens > input.capabilities.maxOutputTokens
  ) {
    changes.push({
      field: "maxTokens",
      from: String(maxTokens),
      to: String(input.capabilities.maxOutputTokens),
      reason: "max-output-limit",
    })
    maxTokens = input.capabilities.maxOutputTokens
  }

  let thinking = input.desired.thinking
  if (thinking !== undefined && input.capabilities?.supportsThinking === false) {
    changes.push({
      field: "thinking",
      from: JSON.stringify(thinking),
      to: undefined,
      reason: "unsupported-by-model-metadata",
    })
    thinking = undefined
  }

  return {
    variant,
    reasoningEffort,
    ...(input.desired.temperature !== undefined ? { temperature } : {}),
    ...(input.desired.topP !== undefined ? { topP } : {}),
    ...(input.desired.maxTokens !== undefined ? { maxTokens } : {}),
    ...(input.desired.thinking !== undefined ? { thinking } : {}),
    changes,
  }
}
