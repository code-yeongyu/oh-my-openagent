export interface SessionEvaluation {
  id: string
  sessionId: string
  agentName: string
  category?: string
  taskDescription?: string
  completionScore: number // 0-100
  efficiencyScore: number // 0-100
  qualityScore: number // 0-100
  toolUsageScore: number // 0-100
  overallScore: number // 0-100 (weighted average)
  toolCallsCount: number
  successfulToolCalls: number
  failedToolCalls: number
  durationMs?: number
  tokenUsage?: number
  errorCount: number
  retryCount: number
  completionStatus: "completed" | "partial" | "failed" | "aborted" | "unknown"
  feedback?: string
  evaluatedAt: Date
}

export interface EvaluationCriteria {
  completionWeight: number
  efficiencyWeight: number
  qualityWeight: number
  toolUsageWeight: number
}

export interface SessionMetrics {
  toolCallsCount: number
  successfulToolCalls: number
  failedToolCalls: number
  durationMs: number
  tokenUsage: number
  errorCount: number
  retryCount: number
  todosCompleted: number
  todosTotal: number
  userSatisfaction?: number // Optional explicit rating
}

export const DEFAULT_CRITERIA: EvaluationCriteria = {
  completionWeight: 0.35,
  efficiencyWeight: 0.25,
  qualityWeight: 0.25,
  toolUsageWeight: 0.15,
}
