import type { PromotionCandidate } from "../memory-core/types"

export interface ClassificationCriteria {
  expected_reuse: boolean
  structural_impact: boolean
  semantic_stability: boolean
  auditability: boolean
  cross_session_relevance: boolean
}

export interface ClassificationTrace {
  candidate_id: string
  criteria_evaluated: ClassificationCriteria
  criteria_met_count: number
  score: number
  decision: "promote" | "skip"
  reason: string
}

export interface ClassifierConfig {
  min_criteria_to_promote: number
  min_score: number
}

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  min_criteria_to_promote: 1,
  min_score: 0.1,
}

export function classifyCandidate(
  candidate: PromotionCandidate,
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
): ClassificationTrace {
  const criteria: ClassificationCriteria = {
    expected_reuse: candidate.classifier_criteria_met.includes("type_matches_promotable"),
    structural_impact:
      candidate.classifier_criteria_met.includes("high_discovery_tokens") ||
      candidate.proposed_type === "decision" ||
      candidate.proposed_type === "rule" ||
      candidate.proposed_type === "convention",
    semantic_stability:
      candidate.classifier_criteria_met.includes("has_narrative") ||
      candidate.classifier_criteria_met.includes("has_concepts"),
    auditability:
      candidate.source_refs.content_hash !== undefined &&
      candidate.source_refs.content_hash !== "",
    cross_session_relevance:
      candidate.proposed_type === "decision" ||
      candidate.proposed_type === "discovery" ||
      candidate.proposed_type === "rule" ||
      candidate.proposed_type === "benchmark",
  }

  const met_count = Object.values(criteria).filter(Boolean).length
  const score = met_count / 5
  const shouldPromote =
    met_count >= config.min_criteria_to_promote && score >= config.min_score

  return {
    candidate_id: candidate.source_memory_id,
    criteria_evaluated: criteria,
    criteria_met_count: met_count,
    score,
    decision: shouldPromote ? "promote" : "skip",
    reason: shouldPromote
      ? `${met_count}/5 criteria met (score: ${score.toFixed(2)})`
      : `Only ${met_count}/5 criteria met (score: ${score.toFixed(2)}), minimum ${config.min_criteria_to_promote} required`,
  }
}
