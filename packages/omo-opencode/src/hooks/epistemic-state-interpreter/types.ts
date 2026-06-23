import type { ConfidenceScore, DependencyInfo } from "./v5-types"

export type EpistemicState =
  | "accepted"
  | "plausible"
  | "open"
  | "operationally_excluded"
  | "excluded"
  | "inconclusive"

export type ProofChainKind = "strict" | "defeasible" | "mixed" | "unknown"

export interface ClassifierInput {
  status: string | undefined
  extensionsIn: number
  extensionsTotal: number
  proofChainKind: ProofChainKind
  hasResidualDefeasibleSupport: boolean
}

export interface EpistemicAnnotation {
  conclusion: string
  state: EpistemicState
  rawClassification: EpistemicState
  reason: string
  timestamp: number
  callID: string
  proofChainKind: ProofChainKind
  extensionMembership: { inCount: number; totalCount: number }
  confidence?: ConfidenceScore
  dependency?: DependencyInfo
}

export type GateMode = "annotation" | "gate" | "hybrid" | "dominance"
