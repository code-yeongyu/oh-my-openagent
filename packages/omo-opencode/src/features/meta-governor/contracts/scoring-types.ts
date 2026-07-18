import type { Decision, EscalationTarget, EvidenceSource } from "./decision-types"

export interface ScoringConfig {
  readonly continueThreshold: number
  readonly warnThreshold: number
  readonly escalateThreshold: number
  readonly stopThreshold: number
  readonly paralysisThreshold: number
  readonly defaultEscalationTarget: EscalationTarget
}

export interface EvidenceContribution {
  readonly source: EvidenceSource
  readonly rawScore: number
  readonly weight: number
  readonly weightedScore: number
  readonly description: string
}

export interface ScoringResult {
  readonly decision: Decision
  readonly contributions: readonly EvidenceContribution[]
  readonly rawScore: number
  readonly paralysisOverride: boolean
  readonly computedAtISO: string
}
