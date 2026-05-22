/**
 * Agent analytics feature - re-exports from core package
 */

export {
  recordMetric,
  getAgentSummary,
  getAllAgentSummaries,
  getTrends,
  getOverallStats,
  clearMetrics,
  closeAnalyticsDb,
  startTimer,
  endTimer,
  captureMetric,
  captureToolCall,
  captureDelegation,
  captureSessionComplete,
  generateReport,
  formatReport,
  formatAgentSummary,
} from "../../../packages/agent-analytics/src"

export type {
  AgentMetricEvent,
  AgentPerformanceSummary,
  AnalyticsReport,
  TrendDataPoint,
  TimeRange,
} from "../../../packages/agent-analytics/src"