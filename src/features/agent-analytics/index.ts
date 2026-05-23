/**
 * Agent analytics feature
 */

export type {
  TimeRange,
  AgentMetricEvent,
  AgentPerformanceSummary,
  AnalyticsReport,
  TrendDataPoint,
} from "./types"

export {
  getAnalyticsDb,
  closeAnalyticsDb,
} from "./storage"

export {
  recordMetric,
  startTimer,
  endTimer,
  captureMetric,
  captureToolCall,
  captureDelegation,
  captureSessionComplete,
} from "./collector"

export {
  getAgentSummary,
  getAllAgentSummaries,
  getOverallStats,
  getTrends,
  generateReport,
  formatReport,
  formatAgentSummary,
  clearMetrics,
} from "./reports"
