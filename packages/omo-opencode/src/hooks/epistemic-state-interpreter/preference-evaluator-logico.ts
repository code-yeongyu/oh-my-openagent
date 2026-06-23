import type { PreferenceEvaluator } from "./preference-evaluator-interface"
import type { ProofChainKind } from "./types"

const LOGICO_SCORES: Record<ProofChainKind, number> = {
  strict: 1,
  mixed: 0.7,
  defeasible: 0.5,
  unknown: 0.3,
}

export function evaluateLogico(proofChainKind: ProofChainKind): number {
  return LOGICO_SCORES[proofChainKind] ?? 0.3
}

export const logicoEvaluator: PreferenceEvaluator = {
  name: "logico",
  evaluate: (annotation) => evaluateLogico(annotation.proofChainKind),
}
