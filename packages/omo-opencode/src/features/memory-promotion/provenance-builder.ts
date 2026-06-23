import type { MemoryProvenance, PromotionCandidate } from "../memory-core/types"
import type { ClassificationTrace } from "./classifier"
import type { RulesEvaluationResult } from "./rules-engine"

export function buildProvenance(input: {
  memory_id: string
  candidate: PromotionCandidate
  classification: ClassificationTrace
  rules_result: RulesEvaluationResult
  promoted_by: string
}): MemoryProvenance {
  const { memory_id, candidate, classification, rules_result, promoted_by } = input

  const classifier_trace = [
    `decision: ${classification.decision}`,
    `score: ${classification.score.toFixed(2)}`,
    `criteria_met: ${classification.criteria_met_count}/5`,
    `rules_passed: ${rules_result.rules_passed.join(",")}`,
    ...(rules_result.rules_failed.length > 0
      ? [`rules_failed: ${rules_result.rules_failed.join(",")}`]
      : []),
  ]

  return {
    memory_id,
    source_kind: candidate.source_kind,
    source_refs: candidate.source_refs,
    promotion_origin: candidate.promotion_origin,
    promoted_at: new Date().toISOString(),
    promoted_by,
    classifier_trace,
  }
}
