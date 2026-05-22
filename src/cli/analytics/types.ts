import type { TimeRange } from "../../features/agent-analytics"

export type AnalyticsOptions = {
  timeRange: TimeRange
  format: "text" | "json"
  agent?: string
}

export type AnalyticsResult = {
  success: boolean
  output: string
}