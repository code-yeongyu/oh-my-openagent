import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

export type SenpiThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>

const SENPI_THINKING_LEVEL_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const

type SenpiThinkingLevelName = (typeof SENPI_THINKING_LEVEL_NAMES)[number]

function isSenpiThinkingLevelName(value: string): value is SenpiThinkingLevelName {
  return (SENPI_THINKING_LEVEL_NAMES as readonly string[]).includes(value)
}

// omo.json reasoningEffort spells the disabled level "none" where senpi spells it "off"; an
// unrecognized variant is dropped so a child keeps the harness default instead of failing CLI
// or session-option validation on a value senpi never heard of.
export function asSenpiThinkingLevel(variant: string | undefined): SenpiThinkingLevel | undefined {
  if (variant === undefined) return undefined
  const normalized = variant === "none" ? "off" : variant
  return isSenpiThinkingLevelName(normalized) ? normalized : undefined
}
