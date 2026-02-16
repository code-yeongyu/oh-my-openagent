export type ToolExecuteAfterInput = {
  tool: string
  sessionID: string
  callID: string
}

export type ToolExecuteAfterOutput = {
  title: string
  output: string
  metadata: Record<string, unknown>
}

export type ToolOutcome = "failed" | "succeeded" | "unknown"

export type LearningKind = "error-correction" | "pattern-discovery" | "successful-approach"

export type LearningRecord = {
  kind: LearningKind
  sessionID: string
  tool: string
  summary: string
  evidence: string
  capturedAt: string
}

export type WisdomCaptureOptions = {
  storeLearning?: (learning: LearningRecord) => Promise<void>
}
