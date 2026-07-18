import type { Decision } from "./decision-types"
import type { ScoringResult } from "./scoring-types"

export interface DecisionHandlerConfig {
  readonly enabled: boolean
  readonly maxHistoryPerSession: number
  readonly forceContinueAfterStops: number
  readonly warnMessageTemplate: string
  readonly escalateMessageTemplate: string
  readonly stopMessageTemplate: string
  readonly defaultEscalationTarget?: string
}

export interface DecisionHandlerInput {
  readonly scoringResult: ScoringResult
  readonly sessionID: string
}

export interface DecisionHistoryEntry {
  readonly decision: Decision
  readonly action: "continue" | "warn" | "escalate" | "stop"
  readonly timestampISO: string
  readonly sessionID: string
  readonly reasoning: string
}

export interface DecisionHandlerOutput {
  readonly action: "continue" | "warn" | "escalate" | "stop"
  readonly message: string | null
  readonly historyEntry: DecisionHistoryEntry
}
