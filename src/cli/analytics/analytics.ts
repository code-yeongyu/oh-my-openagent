import {
  generateReport,
  formatReport,
  getAgentSummary,
  formatAgentSummary,
  clearMetrics,
} from "../../features/agent-analytics"
import type { AnalyticsOptions, AnalyticsResult } from "./types"

export function analytics(options: AnalyticsOptions): AnalyticsResult {
  try {
    if (options.agent) {
      const summary = getAgentSummary(options.agent, options.timeRange)
      if (!summary) {
        return {
          success: false,
          output: `No data found for agent "${options.agent}" in the selected time range.`,
        }
      }
      const output = formatAgentSummary(summary)
      return {
        success: true,
        output: options.format === "json" ? JSON.stringify(summary, null, 2) : output,
      }
    }

    const report = generateReport(options.timeRange)
    const output = formatReport(report)

    return {
      success: true,
      output: options.format === "json" ? JSON.stringify(report, null, 2) : output,
    }
  } catch (error) {
    return {
      success: false,
      output: `Error generating analytics: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function clearAnalytics(timeRange: TimeRange = "all"): AnalyticsResult {
  try {
    const cleared = clearMetrics(timeRange)
    return {
      success: true,
      output: `Cleared ${cleared} metric records.`,
    }
  } catch (error) {
    return {
      success: false,
      output: `Error clearing analytics: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}