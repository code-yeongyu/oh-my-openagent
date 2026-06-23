import type { EpistemicState } from "./types"
import type { HistoryEntry } from "./transition-types"

export interface PersistedConclusionData {
  currentState: EpistemicState
  entries: HistoryEntry[]
  consecutiveCount: number
  lastSeenInvocation: number
  exclusionTheoryHash?: string
}

export interface PersistedSessionState {
  sessionID: string
  updatedAt: number
  conclusions: Record<string, PersistedConclusionData>
}
