import { normalizeModelID } from "./model-normalization"

type CompatibilityField = "variant" | "reasoningEffort"

type DesiredModelSettings = {
  variant?: string
  reasoningEffort?: string
}

type VariantCapabilities = {
  variants?: string[]
}

export type ModelSettingsCompatibilityInput = {
  providerID: string
  modelID: string
  desired: DesiredModelSettings
  capabilities?: VariantCapabilities
}

export type ModelSettingsCompatibilityChange = {
  field: CompatibilityField
  from: string
  to?: string
  reason: "unsupported-by-model-family" | "unknown-model-family" | "unsupported-by-model-metadata"
}

export type ModelSettingsCompatibilityResult = {
  variant?: string
  reasoningEffort?: string
  changes: ModelSettingsCompatibilityChange[]
}

// ---------------------------------------------------------------------------
// Unified model family registry — detection rules + capabilities in ONE row.
// New model family = one entry. Zero code changes anywhere else.
// Order matters: more-specific patterns first (claude-opus before claude).
// ---------------------------------------------------------------------------

type FamilyDefinition = {
  /** Substring(s) in normalised model ID that identify this family (OR) */
  includes?: string[]
  /** Regex when substring matching isn't enough */
  pattern?: RegExp
  /** Supported variant levels (ordered low -> max) */
  variants: string[]
  /** Supported reasoning-effort levels. Omit = not supported. */
  reasoningEffort?: string[]
}

const MODEL_FAMILY_REGISTRY: ReadonlyArray<readonly [string, FamilyDefinition]> = [
  ["claude-opus", { pattern: /claude(?:-\d+(?:-\d+)*)?-opus/, variants: ["low", "medium", "high", "max"] }],
  ["claude-non-opus", { includes: ["claude"], variants: ["low", "medium", "high"] }],
  ["openai-reasoning", { pattern: /^o\d(?:$|-)/, variants: ["low", "medium", "high"], reasoningEffort: ["none", "minimal", "low", "medium", "high"] }],
  ["gpt-5", { includes: ["gpt-5"], variants: ["low", "medium", "high", "xhigh", "max"], reasoningEffort: ["none", "minimal", "low", "medium", "high", "xhigh"] }],
  ["gpt-legacy", { includes: ["gpt"], variants: ["low", "medium", "high"] }],
  ["gemini", { includes: ["gemini"], variants: ["low", "medium", "high"] }],
  ["kimi", { includes: ["kimi", "k2"], variants: ["low", "medium", "high"] }],
  ["glm", { includes: ["glm"], variants: ["low", "medium", "high"] }],
  ["minimax", { includes: ["minimax"], variants: ["low", "medium", "high"] }],
  ["deepseek", { includes: ["deepseek"], variants: ["low", "medium", "high"] }],
  ["mistral", { includes: ["mistral", "codestral"], variants: ["low", "medium", "high"] }],
  ["llama", { includes: ["llama"], variants: ["low", "medium", "high"] }],
]

const VARIANT_LADDER = ["low", "medium", "high", "xhigh", "max"]
const REASONING_LADDER = ["none", "minimal", "low", "medium", "high", "xhigh"]

// ---------------------------------------------------------------------------
// Model family detection — single pass over the registry
// ---------------------------------------------------------------------------

function detectFamily(_providerID: string, modelID: string): FamilyDefinition | undefined {
  const model = normalizeModelID(modelID).toLowerCase()
  for (const [, def] of MODEL_FAMILY_REGISTRY) {
    if (def.pattern?.test(model)) return def
    if (def.includes?.some((s) => model.includes(s))) return def
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Generic resolution — one function for both fields
// ---------------------------------------------------------------------------

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

function normalizeCapabilitiesVariants(capabilities: VariantCapabilities | undefined): string[] | undefined {
  if (!capabilities?.variants || capabilities.variants.length === 0) {
    return undefined
  }
  return capabilities.variants.map((v) => v.toLowerCase())
}

type FieldResolution = { value?: string; reason?: ModelSettingsCompatibilityChange["reason"] }

function resolveField(
  normalized: string,
  familyCaps: string[] | undefined,
  ladder: string[],
  familyKnown: boolean,
  metadataOverride?: string[],
): FieldResolution {
  // Priority 1: runtime metadata from provider
  if (metadataOverride) {
    if (metadataOverride.includes(normalized)) return { value: normalized }
    return {
      value: downgradeWithinLadder(normalized, metadataOverride, ladder),
      reason: "unsupported-by-model-metadata",
    }
  }

  // Priority 2: family heuristic from registry
  if (familyCaps) {
    if (familyCaps.includes(normalized)) return { value: normalized }
    return {
      value: downgradeWithinLadder(normalized, familyCaps, ladder),
      reason: "unsupported-by-model-family",
    }
  }

  // Known family but field not in registry (e.g. Claude + reasoningEffort)
  if (familyKnown) {
    return { value: undefined, reason: "unsupported-by-model-family" }
  }

  // Unknown family — drop the value
  return { value: undefined, reason: "unknown-model-family" }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveCompatibleModelSettings(
  input: ModelSettingsCompatibilityInput,
): ModelSettingsCompatibilityResult {
  const family = detectFamily(input.providerID, input.modelID)
  const familyKnown = family !== undefined
  const changes: ModelSettingsCompatibilityChange[] = []
  const metadataVariants = normalizeCapabilitiesVariants(input.capabilities)

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
    const resolved = resolveField(normalized, family?.reasoningEffort, REASONING_LADDER, familyKnown)
    if (resolved.value !== normalized && resolved.reason) {
      changes.push({ field: "reasoningEffort", from: reasoningEffort, to: resolved.value, reason: resolved.reason })
    }
    reasoningEffort = resolved.value
  }

  return { variant, reasoningEffort, changes }
}
