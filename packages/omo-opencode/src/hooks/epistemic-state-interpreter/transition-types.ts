import type { EpistemicState } from "./types"

export type TransitionID = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9" | "T10" | "T11" | "T12" | "T13"

export interface TransitionRecord {
  id: TransitionID
  from: EpistemicState
  to: EpistemicState
  conclusion: string
  timestamp: number
  reason: string
}

export interface HistoryEntry {
  classification: EpistemicState
  timestamp: number
  callID: string
}

export interface ConclusionHistory {
  currentState: EpistemicState
  entries: HistoryEntry[]
  consecutiveCount: number
  lastClassification: EpistemicState
  lastSeenInvocation?: number
  exclusionTheoryHash?: string
}
