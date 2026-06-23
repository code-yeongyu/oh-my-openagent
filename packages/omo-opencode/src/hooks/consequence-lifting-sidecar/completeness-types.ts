export type CompletenessGapSeverity = "high" | "critical"

export type CompletenessGapCode =
  | "missing_required_condition"
  | "missing_required_mitigation"
  | "missing_viable_alternative"
  | "under_modeled_selected_policy"

export interface CompletenessGap {
  code: CompletenessGapCode
  severity: CompletenessGapSeverity
  subject: string
  message: string
}

export interface JustifiedCompletenessOmission {
  decision: string
  reason: "blocked_or_rejected_alternative"
}

export interface PolicyCompletenessResult {
  status: "complete" | "incomplete"
  targetDecision: string
  gaps: CompletenessGap[]
  justifiedOmissions: JustifiedCompletenessOmission[]
}
