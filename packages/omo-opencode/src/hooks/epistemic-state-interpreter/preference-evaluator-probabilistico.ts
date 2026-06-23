import type { PreferenceEvaluator } from "./preference-evaluator-interface"

export function evaluateProbabilistico(extensionsIn: number, extensionsTotal: number): number {
  if (extensionsTotal === 0) return 0
  return extensionsIn / extensionsTotal
}

export const probabilisticoEvaluator: PreferenceEvaluator = {
  name: "probabilistico",
  evaluate: (annotation) =>
    evaluateProbabilistico(
      annotation.extensionMembership.inCount,
      annotation.extensionMembership.totalCount,
    ),
}
