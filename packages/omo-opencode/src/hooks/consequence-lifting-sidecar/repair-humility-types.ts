export type RepairCapacity = "repairable" | "partially_repairable" | "irreparable"

export interface RepairEscalationReason {
  code: string
  message: string
}

export interface HumilityReport {
  capacity: RepairCapacity
  escalationReasons: RepairEscalationReason[]
  summary: string
}

export interface RepairHumilitySemanticsComparison {
  grounded_set: string[]
  preferred_extensions: string[][]
  stable_extensions: string[][]
  complete_extensions: string[][]
  certainty_gradient: {
    certain: string[]
    defensible: string[]
    contested: string[]
  }
}

export interface RepairHumilityConfidenceScores {
  framework_certainty?: number | null
  world_certainty?: number | null
}

export type RepairHumilityConvergenceStatus = "converged" | "looping" | "not_converged" | "unable_to_converge"

export interface RepairHumilityContext {
  selectedDecision?: string | null
  semanticsComparison?: RepairHumilitySemanticsComparison
  confidence?: RepairHumilityConfidenceScores
  preferenceCycleDetected?: boolean
  preferenceCyclePath?: string[]
  convergence?: RepairHumilityConvergenceStatus
  revisedPremises?: string[]
}
