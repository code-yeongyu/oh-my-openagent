export interface EvaluationEntry {
  id: string
  sessionId: string
  agentName: string
  category?: string
  taskDescription?: string
  completionScore: number
  qualityScore: number
  efficiencyScore: number
  errorCount: number
  toolCallCount: number
  durationMs: number
  todosCompleted: number
  todosTotal: number
  feedback?: string
  evaluatedAt: Date
}

export interface EvaluationMetrics {
  avgCompletionScore: number
  avgQualityScore: number
  avgEfficiencyScore: number
  totalEvaluations: number
  errorRate: number
  avgToolCalls: number
  avgDurationMs: number
  todoCompletionRate: number
}

export interface AgentScore {
  agentName: string
  overallScore: number
  metrics: EvaluationMetrics
  trend: "improving" | "stable" | "declining"
  recommendation: string
}
