/**
 * Agent performance analytics types
 */

export type AgentMetricEvent = {
  id: string
  timestamp: Date
  sessionId: string
  agentName: string
  category: string
  eventType: "tool_call" | "tool_result" | "delegation" | "session_complete"
  toolName?: string
  durationMs: number
  success: boolean
  tokenCount?: number
  errorType?: string
  metadata?: Record<string, unknown>
}

export type AgentPerformanceSummary = {
  agentName: string
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  avgDurationMs: number
  totalTokens: number
  successRate: number
  lastUsed: Date
}

export type TrendDataPoint = {
  date: string
  totalCalls: number
  successRate: number
  avgDurationMs: number
}

export type AnalyticsReport = {
  generatedAt: Date
  period: { start: Date; end: Date }
  summaries: AgentPerformanceSummary[]
  overallSuccessRate: number
  overallAvgDurationMs: number
  trends: TrendDataPoint[]
}

export type TimeRange = "24h" | "7d" | "30d" | "all"