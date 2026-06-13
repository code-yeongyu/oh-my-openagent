export interface DecisionContext {
  readonly oracleVerified: boolean
  readonly noProgress: boolean
  readonly deviations: readonly Deviation[]
  readonly iterationRatio: number
  readonly lessonsRelevant: readonly RelevantLesson[]
  readonly slotMemory: SlotMemory
  readonly ambient: AmbientContext
}

export interface Decision {
  readonly action: "continue" | "warn" | "escalate" | "stop"
  readonly score: number
  readonly reasoning: string
  readonly evidence: readonly Evidence[]
  readonly shouldEscalateTo: EscalationTarget | null
}

export type EscalationTarget = "oracle" | "user"

export interface Evidence {
  readonly source: EvidenceSource
  readonly value: string
  readonly confidence: number
  readonly weight: number
}

export type EvidenceSource =
  | "oracle-verified"
  | "no-progress-detector"
  | "deviation-detector"
  | "iteration-budget"
  | "lesson-recall"
  | "slot-memory"
  | "ambient"
  | "token-predictor"

export interface Deviation {
  readonly severity: "leve" | "media" | "grave"
  readonly category: string
  readonly detail: string
  readonly filePath?: string
}

export interface RelevantLesson {
  readonly id: string
  readonly title: string
  readonly advice: "continue" | "stop" | "warn" | "info"
  readonly confidence: number
  readonly concepts: readonly string[]
}

export interface SlotMemory {
  readonly lastDecision?: Decision
  readonly consecutiveStops: number
  readonly consecutiveContinues: number
  readonly lastUpdatedISO: string
}

export interface AmbientContext {
  readonly sessionID: string
  readonly directory: string
  readonly mode: "ultrawork" | "ulw" | "simple" | "ralph-loop"
  readonly agentName: string
  readonly iteration: number
  readonly maxIterations: number
}
