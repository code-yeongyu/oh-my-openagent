import type {
  MoraleOutput,
  PragmaticoOutput,
} from "../epistemic-state-interpreter/multi-plane-types"

export interface SemanticsComparison {
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

export interface PianoCEticoAnalysis {
  deontological?: Record<string, number>
  consequentialist?: Record<string, number>
  virtue_ethics?: Record<string, number>
}

export interface EpistemicAnalysis {
  piano_a?: Record<string, string>
  piano_b?: Record<string, number>
  piano_c?: {
    etico?: PianoCEticoAnalysis
    morale?: Record<string, MoraleOutput>
    pragmatico?: Record<string, PragmaticoOutput>
  }
  piano_d?: {
    synthesis: string
    dominant_conclusion?: string
    confidence: number
  }
}

export interface AudienceResult {
  audience_id: string
  audience_label: string
  value_ordering: string[]
  selected_option?: string
  verdict: string
}

export interface AudienceAnalysis {
  audiences: AudienceResult[]
  consensus: "unanimous" | "majority" | "split"
  per_audience: Record<string, AudienceResult>
}

export interface ConfidenceScores {
  framework_certainty: number
  world_certainty: number
}

export type ConvergenceStatus = "converged" | "looping" | "not_converged" | "unable_to_converge"

export interface ExtendedDeliberationFields {
  semantics_comparison?: SemanticsComparison
  epistemic_analysis?: EpistemicAnalysis
  audience_analysis?: AudienceAnalysis
  confidence?: ConfidenceScores
  convergence?: ConvergenceStatus
  preference_cycle_detected?: boolean
  preference_cycle_path?: string[]
  revised_premises?: string[]
}
