import type { ResolvedModelRecord } from "./types"

// Legacy spellings stay in the read chain until the deprecation window closes: older persisted
// records carry `reasoning_effort` and older runtime-fallback events carry `variant`.
export function readResolvedReasoning(model: ResolvedModelRecord): string | undefined {
  return model.reasoning ?? model.reasoning_effort ?? model.variant
}

export function resolvedReasoningFields(
  model: ResolvedModelRecord,
): { readonly reasoning?: string; readonly variant?: string } {
  const reasoning = readResolvedReasoning(model)
  return reasoning === undefined ? {} : { reasoning, variant: reasoning }
}
