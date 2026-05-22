// IMPORTED BY: tui — keep pure data, no runtime side effects
import type { FallbackEntry, ModelRequirement } from "../../shared/model-requirements"

export type { FallbackEntry }

export type RoleRow = {
  role: string
  providerID: string
  modelID: string
  isOverride: boolean // ◆ marker iff true
  hasEffectiveDefault: boolean // false for unknown roles → suppresses ◆ + ↓
  fallbackChain: FallbackEntry[] // empty array for unknown roles
}

export type DeriveRowInput = {
  role: string
  // configuredDefault is `state.config.agent?.[role]?.model` — verified at types.gen.d.ts:1269-1278
  configuredDefault: string | undefined
  // observed comes from AssistantMessage flat fields (types.gen.d.ts:478-479), NOT message.model.X
  observed: { providerID: string; modelID: string }
  // requirements is AGENT_MODEL_REQUIREMENTS[role] (src/shared/model-requirements.ts:20) or undefined for unknown roles
  requirements: ModelRequirement | undefined
}

export function deriveRow(input: DeriveRowInput): RoleRow {
  const { role, configuredDefault, observed, requirements } = input

  // Effective-default rule (fixes Architect A1): prefer explicit config; else first fallback entry.
  // Unknown role policy (fixes Critic C4): if BOTH configuredDefault is undefined AND requirements is undefined,
  // hasEffectiveDefault is false → isOverride is always false → renderer skips ◆ and skips ↓ expansion.
  let effectiveDefault: string | undefined = configuredDefault
  if (!effectiveDefault && requirements && requirements.fallbackChain.length > 0) {
    const first = requirements.fallbackChain[0]
    if (first.providers.length > 0) {
      effectiveDefault = `${first.providers[0]}/${first.model}`
    }
  }
  const hasEffectiveDefault = effectiveDefault !== undefined
  const observedStr = `${observed.providerID}/${observed.modelID}`
  const isOverride = hasEffectiveDefault && observedStr !== effectiveDefault

  return {
    role,
    providerID: observed.providerID,
    modelID: observed.modelID,
    isOverride,
    hasEffectiveDefault,
    fallbackChain: requirements?.fallbackChain ?? [],
  }
}
