import { getAnalyticsDb } from "./storage"
import type { TimeRange, AgentPerformanceSummary, AnalyticsReport, TrendDataPoint } from "./types"

function getTimeRangeMs(range: TimeRange): number {
  const now = Date.now()
  switch (range) {
    case "24h":
      return now - 24 * 60 * 60 * 1000
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000
    case "all":
      return 0
  }
}

export function getAgentSummary(agentName: string, timeRange: TimeRange): AgentPerformanceSummary | null {
  const db = getAnalyticsDb()
  const cutoff = getTimeRangeMs(timeRange)

  const result = db.query(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      AVG(duration_ms) as avg_duration,
      SUM(COALESCE(token_count, 0)) as total_tokens
    FROM agent_metrics 
    WHERE agent_name = ? AND timestamp >= ?`,
  ).get(agentName, cutoff) as {
    total: number
    successes: number
    avg_duration: number | null
    total_tokens: number | null
  }

  if (result.total === 0) return null

  const toolBreakdown = db.query(
    `SELECT 
      tool_name,
      COUNT(*) as count,
      AVG(duration_ms) as avg_duration,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
    FROM agent_metrics 
    WHERE agent_name = ? AND timestamp >= ? AND tool_name IS NOT NULL
    GROUP BY tool_name`,
  ).all(agentName, cutoff) as Array<{
    tool_name: string
    count: number
    avg_duration: number
    success_rate: number
  }>

  const categoryBreakdown = db.query(
    `SELECT category, COUNT(*) as count 
    FROM agent_metrics 
    WHERE agent_name = ? AND timestamp >= ?
    GROUP BY category`,
  ).all(agentName, cutoff) as Array<{ category: string; count: number }>

  const errorBreakdown = db.query(
    `SELECT error_type, COUNT(*) as count 
    FROM agent_metrics 
    WHERE agent_name = ? AND timestamp >= ? AND error_type IS NOT NULL
    GROUP BY error_type`,
  ).all(agentName, cutoff) as Array<{ error_type: string; count: number }>

  const tools: AgentPerformanceSummary["toolBreakdown"] = {}
  for (const row of toolBreakdown) {
    tools[row.tool_name] = {
      count: row.count,
      avgDurationMs: Math.round(row.avg_duration ?? 0),
      successRate: Math.round(row.success_rate * 100) / 100,
    }
  }

  const categories: Record<string, number> = {}
  for (const row of categoryBreakdown) {
    categories[row.category] = row.count
  }

  const errors: Record<string, number> = {}
  for (const row of errorBreakdown) {
    errors[row.error_type] = row.count
  }

  return {
    agentName,
    totalEvents: result.total,
    successRate: Math.round((result.successes / result.total) * 10000) / 100,
    avgDurationMs: Math.round(result.avg_duration ?? 0),
    totalTokens: result.total_tokens ?? 0,
    toolBreakdown: tools,
    categoryBreakdown: categories,
    errorBreakdown: errors,
    trend: "stable",
  }
}

export function getAllAgentSummaries(timeRange: TimeRange): AgentPerformanceSummary[] {
  const db = getAnalyticsDb()
  const cutoff = getTimeRangeMs(timeRange)

  const agents = db.query(
    `SELECT DISTINCT agent_name FROM agent_metrics WHERE timestamp >= ?`,
  ).all(cutoff) as Array<{ agent_name: string }>

  return agents
    .map((row) => getAgentSummary(row.agent_name, timeRange))
    .filter((summary): summary is AgentPerformanceSummary => summary !== null)
}

export function getOverallStats(timeRange: TimeRange): AnalyticsReport["overallStats"] {
  const db = getAnalyticsDb()
  const cutoff = getTimeRangeMs(timeRange)

  const result = db.query(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      AVG(duration_ms) as avg_duration,
      SUM(COALESCE(token_count, 0)) as total_tokens,
      SUM(CASE WHEN error_type IS NOT NULL THEN 1 ELSE 0 END) as total_errors
    FROM agent_metrics 
    WHERE timestamp >= ?`,
  ).get(cutoff) as {
    total: number
    successes: number
    avg_duration: number | null
    total_tokens: number | null
    total_errors: number
  }

  return {
    totalEvents: result.total,
    overallSuccessRate: result.total > 0 ? Math.round((result.successes / result.total) * 10000) / 100 : 0,
    overallAvgDurationMs: Math.round(result.avg_duration ?? 0),
    totalTokens: result.total_tokens ?? 0,
    totalErrors: result.total_errors,
  }
}

export function getTrends(agentName: string, days: number = 7): TrendDataPoint[] {
  const db = getAnalyticsDb()
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

  const results = db.query(
    `SELECT 
      date(timestamp / 1000, 'unixepoch') as date,
      COUNT(*) as events,
      AVG(CASE WHEN success = 1 THEN 100 ELSE 0 END) as score
    FROM agent_metrics 
    WHERE agent_name = ? AND timestamp >= ?
    GROUP BY date
    ORDER BY date`,
  ).all(agentName, cutoff) as Array<{ date: string; events: number; score: number }>

  return results.map((row) => ({
    date: row.date,
    score: Math.round(row.score * 100) / 100,
    events: row.events,
  }))
}

export function generateReport(timeRange: TimeRange): AnalyticsReport {
  const overallStats = getOverallStats(timeRange)
  const agentSummaries = getAllAgentSummaries(timeRange)

  const db = getAnalyticsDb()
  const cutoff = getTimeRangeMs(timeRange)

  const topTools = db.query(
    `SELECT 
      tool_name,
      COUNT(*) as count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
    FROM agent_metrics 
    WHERE timestamp >= ? AND tool_name IS NOT NULL
    GROUP BY tool_name
    ORDER BY count DESC
    LIMIT 10`,
  ).all(cutoff) as Array<{ tool_name: string; count: number; success_rate: number }>

  const topErrors = db.query(
    `SELECT 
      error_type,
      COUNT(*) as count
    FROM agent_metrics 
    WHERE timestamp >= ? AND error_type IS NOT NULL
    GROUP BY error_type
    ORDER BY count DESC
    LIMIT 10`,
  ).all(cutoff) as Array<{ error_type: string; count: number }>

  return {
    timeRange,
    generatedAt: new Date(),
    overallStats,
    agentSummaries,
    topTools: topTools.map((row) => ({
      toolName: row.tool_name,
      count: row.count,
      successRate: Math.round(row.success_rate * 100) / 100,
    })),
    topErrors: topErrors.map((row) => ({
      errorType: row.error_type,
      count: row.count,
    })),
  }
}

export function formatReport(report: AnalyticsReport): string {
  const lines = [
    `Agent Performance Analytics Report`,
    `Generated: ${report.generatedAt.toISOString()}`,
    `Time Range: ${report.timeRange}`,
    ``,
    `Overall Statistics:`,
    `  Total Events: ${report.overallStats.totalEvents}`,
    `  Success Rate: ${report.overallStats.overallSuccessRate}%`,
    `  Avg Duration: ${report.overallStats.overallAvgDurationMs}ms`,
    `  Total Tokens: ${report.overallStats.totalTokens}`,
    `  Total Errors: ${report.overallStats.totalErrors}`,
    ``,
    `Agent Summaries (${report.agentSummaries.length} agents):`,
  ]

  for (const agent of report.agentSummaries) {
    lines.push(`  ${agent.agentName}:`)
    lines.push(`    Events: ${agent.totalEvents}`)
    lines.push(`    Success Rate: ${agent.successRate}%`)
    lines.push(`    Avg Duration: ${agent.avgDurationMs}ms`)
    lines.push(`    Total Tokens: ${agent.totalTokens}`)
  }

  if (report.topTools.length > 0) {
    lines.push(``)
    lines.push(`Top Tools:`)
    for (const tool of report.topTools) {
      lines.push(`  ${tool.toolName}: ${tool.count} calls (${tool.successRate}% success)`)
    }
  }

  if (report.topErrors.length > 0) {
    lines.push(``)
    lines.push(`Top Errors:`)
    for (const error of report.topErrors) {
      lines.push(`  ${error.errorType}: ${error.count} occurrences`)
    }
  }

  return lines.join("\n")
}

export function formatAgentSummary(summary: AgentPerformanceSummary): string {
  const lines = [
    `Agent: ${summary.agentName}`,
    `Total Events: ${summary.totalEvents}`,
    `Success Rate: ${summary.successRate}%`,
    `Avg Duration: ${summary.avgDurationMs}ms`,
    `Total Tokens: ${summary.totalTokens}`,
    `Trend: ${summary.trend}`,
  ]

  if (Object.keys(summary.toolBreakdown).length > 0) {
    lines.push(``)
    lines.push(`Tool Breakdown:`)
    for (const [tool, stats] of Object.entries(summary.toolBreakdown)) {
      lines.push(`  ${tool}: ${stats.count} calls, ${stats.avgDurationMs}ms avg, ${stats.successRate}% success`)
    }
  }

  if (Object.keys(summary.errorBreakdown).length > 0) {
    lines.push(``)
    lines.push(`Error Breakdown:`)
    for (const [error, count] of Object.entries(summary.errorBreakdown)) {
      lines.push(`  ${error}: ${count} occurrences`)
    }
  }

  return lines.join("\n")
}

export function clearMetrics(timeRange: TimeRange): number {
  const db = getAnalyticsDb()
  const cutoff = getTimeRangeMs(timeRange)

  if (timeRange === "all") {
    const result = db.query(`SELECT COUNT(*) as count FROM agent_metrics`).get() as { count: number }
    db.run(`DELETE FROM agent_metrics`)
    return result.count
  }

  const result = db.query(`SELECT COUNT(*) as count FROM agent_metrics WHERE timestamp < ?`).get(cutoff) as {
    count: number
  }
  db.run(`DELETE FROM agent_metrics WHERE timestamp < ?`, [cutoff])
  return result.count
}
