/**
 * Agent analytics reports
 */

import type { AnalyticsReport, TimeRange, AgentPerformanceSummary } from "./types"
import {
  getAllAgentSummaries,
  getTrends,
  getOverallStats,
} from "./storage"

export function generateReport(timeRange: TimeRange = "7d"): AnalyticsReport {
  const summaries = getAllAgentSummaries(timeRange)
  const trends = getTrends(timeRange)
  const overall = getOverallStats(timeRange)

  const now = new Date()
  const since = getPeriodStart(timeRange, now)

  return {
    generatedAt: now,
    period: { start: since, end: now },
    summaries,
    overallSuccessRate: overall.overallSuccessRate,
    overallAvgDurationMs: overall.overallAvgDurationMs,
    trends,
  }
}

export function formatReport(report: AnalyticsReport): string {
  const lines: string[] = []
  lines.push("# Agent Performance Analytics Report")
  lines.push("")
  lines.push(
    `Period: ${report.period.start.toLocaleDateString()} - ${report.period.end.toLocaleDateString()}`,
  )
  lines.push(`Generated: ${report.generatedAt.toLocaleString()}`)
  lines.push("")
  lines.push("## Overall Statistics")
  lines.push(`- Success Rate: ${(report.overallSuccessRate * 100).toFixed(1)}%`)
  lines.push(`- Avg Duration: ${formatDuration(report.overallAvgDurationMs)}`)
  lines.push("")

  if (report.summaries.length === 0) {
    lines.push("No data available for the selected period.")
    return lines.join("\n")
  }

  lines.push("## Agent Performance")
  lines.push("")
  lines.push(
    "| Agent | Calls | Success | Failed | Success Rate | Avg Duration | Tokens |",
  )
  lines.push(
    "|-------|-------|---------|--------|--------------|--------------|--------|",
  )

  for (const s of report.summaries) {
    lines.push(
      `| ${s.agentName} | ${s.totalCalls} | ${s.successfulCalls} | ${s.failedCalls} | ${(s.successRate * 100).toFixed(1)}% | ${formatDuration(s.avgDurationMs)} | ${s.totalTokens} |`,
    )
  }

  lines.push("")
  lines.push("## Trends")
  lines.push("")
  if (report.trends.length === 0) {
    lines.push("No trend data available.")
  } else {
    lines.push("| Date | Calls | Success Rate | Avg Duration |")
    lines.push("|------|-------|--------------|--------------|")
    for (const t of report.trends) {
      lines.push(
        `| ${t.date} | ${t.totalCalls} | ${(t.successRate * 100).toFixed(1)}% | ${formatDuration(t.avgDurationMs)} |`,
      )
    }
  }

  return lines.join("\n")
}

export function formatAgentSummary(summary: AgentPerformanceSummary): string {
  const lines: string[] = []
  lines.push(`# ${summary.agentName} Performance Summary`)
  lines.push("")
  lines.push(`- Total Calls: ${summary.totalCalls}`)
  lines.push(`- Successful: ${summary.successfulCalls}`)
  lines.push(`- Failed: ${summary.failedCalls}`)
  lines.push(`- Success Rate: ${(summary.successRate * 100).toFixed(1)}%`)
  lines.push(`- Average Duration: ${formatDuration(summary.avgDurationMs)}`)
  lines.push(`- Total Tokens: ${summary.totalTokens}`)
  lines.push(`- Last Used: ${summary.lastUsed.toLocaleString()}`)
  return lines.join("\n")
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ${seconds % 60}s`
}

function getPeriodStart(timeRange: TimeRange, now: Date): Date {
  switch (timeRange) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    case "all":
      return new Date(0)
  }
}