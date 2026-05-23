/**
 * Agent analytics feature - direct implementation
 */

export type TimeRange = "24h" | "7d" | "30d" | "all"

export interface AgentMetricEvent {
  id: string
  timestamp: Date
  sessionId: string
  agentName: string
  category: string
  eventType: "tool_call" | "delegation" | "session_start" | "session_complete" | "error"
  toolName?: string
  durationMs?: number
  success: boolean
  errorType?: string
  tokenCount?: number
}

export interface AgentPerformanceSummary {
  agentName: string
  totalEvents: number
  successRate: number
  avgDurationMs: number
  totalTokens: number
  toolBreakdown: Record<string, { count: number; avgDurationMs: number; successRate: number }>
  categoryBreakdown: Record<string, number>
  errorBreakdown: Record<string, number>
  trend: "improving" | "declining" | "stable"
}

export interface AnalyticsReport {
  timeRange: TimeRange
  generatedAt: Date
  overallStats: {
    totalEvents: number
    overallSuccessRate: number
    overallAvgDurationMs: number
    totalTokens: number
    totalErrors: number
  }
  agentSummaries: AgentPerformanceSummary[]
  topTools: Array<{ toolName: string; count: number; successRate: number }>
  topErrors: Array<{ errorType: string; count: number }>
}

export interface TrendDataPoint {
  date: string
  score: number
  events: number
}
