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

type ModelFamily = "claude-opus" | "claude-non-opus" | "openai-reasoning" | "gpt-5" | "gpt-5-mini" | "gpt-legacy" | "unknown"

const VARIANT_LADDER = ["low", "medium", "high", "xhigh", "max"]
const REASONING_LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

function detectModelFamily(providerID: string, modelID: string): ModelFamily {
  const provider = providerID.toLowerCase()
  const model = normalizeModelID(modelID).toLowerCase()

  const isClaudeProvider = [
    "anthropic",
    "google-vertex-anthropic",
    "aws-bedrock-anthropic",
  ].includes(provider)
    || (["github-copilot", "opencode", "aws-bedrock", "bedrock"].includes(provider) && model.includes("claude"))

  if (isClaudeProvider) {
    return /claude(?:-\d+(?:-\d+)*)?-opus/.test(model) ? "claude-opus" : "claude-non-opus"
  }

  const isOpenAiReasoningFamily = provider === "openai" && (/^o\d(?:$|-)/.test(model) || model.includes("reasoning"))
  if (isOpenAiReasoningFamily) {
    return "openai-reasoning"
  }

  if (/gpt-5.*-mini/.test(model)) {
    return "gpt-5-mini"
  }

  if (model.includes("gpt-5")) {
    return "gpt-5"
  }

  if (model.includes("gpt") || (provider === "openai" && /^o\d(?:$|-)/.test(model))) {
    return "gpt-legacy"
  }

  return "unknown"
}

function downgradeWithinLadder(value: string, allowed: string[], ladder: string[]): string | undefined {
  const requestedIndex = ladder.indexOf(value)
  if (requestedIndex === -1) return undefined

  for (let index = requestedIndex; index >= 0; index -= 1) {
    const candidate = ladder[index]
    if (allowed.includes(candidate)) {
      return candidate
    }
  }

  return undefined
}

function normalizeCapabilitiesVariants(capabilities: VariantCapabilities | undefined): string[] | undefined {
  if (!capabilities?.variants || capabilities.variants.length === 0) {
    return undefined
  }

  return capabilities.variants.map((variant) => variant.toLowerCase())
}

function resolveVariant(
  modelFamily: ModelFamily,
  variant: string,
  capabilities?: VariantCapabilities,
): { value?: string; reason?: ModelSettingsCompatibilityChange["reason"] } {
  const normalized = variant.toLowerCase()
  const metadataVariants = normalizeCapabilitiesVariants(capabilities)

  if (metadataVariants) {
    if (metadataVariants.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, metadataVariants, VARIANT_LADDER),
      reason: "unsupported-by-model-metadata",
    }
  }

  if (modelFamily === "claude-opus") {
    const allowed = ["low", "medium", "high", "max"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, VARIANT_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  if (modelFamily === "claude-non-opus") {
    const allowed = ["low", "medium", "high"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, VARIANT_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  if (modelFamily === "gpt-5" || modelFamily === "gpt-5-mini") {
    const allowed = ["low", "medium", "high", "xhigh", "max"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, VARIANT_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  if (modelFamily === "openai-reasoning") {
    const allowed = ["low", "medium", "high"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, VARIANT_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  if (modelFamily === "gpt-legacy") {
    const allowed = ["low", "medium", "high"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, VARIANT_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  return { value: undefined, reason: "unknown-model-family" }
}

function resolveReasoningEffort(modelFamily: ModelFamily, reasoningEffort: string): { value?: string; reason?: ModelSettingsCompatibilityChange["reason"] } {
  const normalized = reasoningEffort.toLowerCase()

  if (modelFamily === "gpt-5") {
    const allowed = ["none", "minimal", "low", "medium", "high", "xhigh"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, REASONING_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  if (modelFamily === "gpt-5-mini") {
    return { value: undefined, reason: "unsupported-by-model-family" }
  }

  if (modelFamily === "openai-reasoning") {
    const allowed = ["none", "minimal", "low", "medium", "high"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, REASONING_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  if (modelFamily === "gpt-legacy") {
    const allowed = ["none", "minimal", "low", "medium", "high"]
    if (allowed.includes(normalized)) {
      return { value: normalized }
    }
    return {
      value: downgradeWithinLadder(normalized, allowed, REASONING_LADDER),
      reason: "unsupported-by-model-family",
    }
  }

  if (modelFamily === "claude-opus" || modelFamily === "claude-non-opus") {
    return { value: undefined, reason: "unsupported-by-model-family" }
  }

  return { value: undefined, reason: "unknown-model-family" }
}

export function resolveCompatibleModelSettings(
  input: ModelSettingsCompatibilityInput,
): ModelSettingsCompatibilityResult {
  const modelFamily = detectModelFamily(input.providerID, input.modelID)
  const changes: ModelSettingsCompatibilityChange[] = []

  let variant = input.desired.variant
  if (variant !== undefined) {
    const normalizedVariant = variant.toLowerCase()
    const resolved = resolveVariant(modelFamily, normalizedVariant, input.capabilities)
    if (resolved.value !== normalizedVariant && resolved.reason) {
      changes.push({
        field: "variant",
        from: variant,
        to: resolved.value,
        reason: resolved.reason,
      })
    }
    variant = resolved.value
  }

  let reasoningEffort = input.desired.reasoningEffort
  if (reasoningEffort !== undefined) {
    const normalizedReasoningEffort = reasoningEffort.toLowerCase()
    const resolved = resolveReasoningEffort(modelFamily, normalizedReasoningEffort)
    if (resolved.value !== normalizedReasoningEffort && resolved.reason) {
      changes.push({
        field: "reasoningEffort",
        from: reasoningEffort,
        to: resolved.value,
        reason: resolved.reason,
      })
    }
    reasoningEffort = resolved.value
  }

  return {
    variant,
    reasoningEffort,
    changes,
  }
}
