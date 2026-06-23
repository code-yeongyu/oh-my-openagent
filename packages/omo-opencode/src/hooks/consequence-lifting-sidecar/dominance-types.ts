export type DominanceDecision = "left" | "right" | "tie"

export interface DominanceReason {
  criterion: string
  winner: DominanceDecision
}

export interface DominanceVerdict {
  winner: DominanceDecision
  reasons: DominanceReason[]
}
