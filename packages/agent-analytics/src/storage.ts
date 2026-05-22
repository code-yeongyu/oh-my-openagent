/**
 * Agent analytics SQLite storage
 */

import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import type { AgentMetricEvent, AgentPerformanceSummary, TrendDataPoint, TimeRange } from "./types"

const ANALYTICS_DIR = join(homedir(), ".omo", "analytics")
const ANALYTICS_DB_PATH = join(ANALYTICS_DIR, "agent-metrics.db")

let db: Database | null = null

function getDb(): Database {
  if (db) return db
  mkdirSync(ANALYTICS_DIR, { recursive: true })
  db = new Database(ANALYTICS_DB_PATH)
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_metrics (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      category TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      duration_ms INTEGER NOT NULL,
      success INTEGER NOT NULL,
      token_count INTEGER,
      error_type TEXT,
      metadata TEXT
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_metrics_agent ON agent_metrics(agent_name)
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON agent_metrics(timestamp)
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_metrics_session ON agent_metrics(session_id)
  `)
  return db
}

export function recordMetric(event: AgentMetricEvent): void {
  const database = getDb()
  database.run(
    `
    INSERT INTO agent_metrics (
      id, timestamp, session_id, agent_name, category, event_type,
      tool_name, duration_ms, success, token_count, error_type, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      event.id,
      event.timestamp.toISOString(),
      event.sessionId,
      event.agentName,
      event.category,
      event.eventType,
      event.toolName ?? null,
      event.durationMs,
      event.success ? 1 : 0,
      event.tokenCount ?? null,
      event.errorType ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
    ],
  )
}

export function getAgentSummary(
  agentName: string,
  timeRange: TimeRange = "7d",
): AgentPerformanceSummary | null {
  const database = getDb()
  const since = getSinceDate(timeRange)
  const row = database
    .query(
      `
    SELECT
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_calls,
      AVG(duration_ms) as avg_duration,
      SUM(COALESCE(token_count, 0)) as total_tokens,
      MAX(timestamp) as last_used
    FROM agent_metrics
    WHERE agent_name = ? AND timestamp >= ?
  `,
    )
    .get(agentName, since.toISOString()) as
    | {
        total_calls: number
        successful_calls: number
        failed_calls: number
        avg_duration: number
        total_tokens: number
        last_used: string
      }
    | undefined

  if (!row || row.total_calls === 0) return null

  return {
    agentName,
    totalCalls: row.total_calls,
    successfulCalls: row.successful_calls,
    failedCalls: row.failed_calls,
    avgDurationMs: Math.round(row.avg_duration),
    totalTokens: row.total_tokens,
    successRate: row.total_calls > 0 ? row.successful_calls / row.total_calls : 0,
    lastUsed: new Date(row.last_used),
  }
}

export function getAllAgentSummaries(timeRange: TimeRange = "7d"): AgentPerformanceSummary[] {
  const database = getDb()
  const since = getSinceDate(timeRange)
  const rows = database
    .query(
      `
    SELECT
      agent_name,
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_calls,
      AVG(duration_ms) as avg_duration,
      SUM(COALESCE(token_count, 0)) as total_tokens,
      MAX(timestamp) as last_used
    FROM agent_metrics
    WHERE timestamp >= ?
    GROUP BY agent_name
    ORDER BY total_calls DESC
  `,
    )
    .all(since.toISOString()) as Array<{
      agent_name: string
      total_calls: number
      successful_calls: number
      failed_calls: number
      avg_duration: number
      total_tokens: number
      last_used: string
    }>

  return rows.map((row) => ({
    agentName: row.agent_name,
    totalCalls: row.total_calls,
    successfulCalls: row.successful_calls,
    failedCalls: row.failed_calls,
    avgDurationMs: Math.round(row.avg_duration),
    totalTokens: row.total_tokens,
    successRate: row.total_calls > 0 ? row.successful_calls / row.total_calls : 0,
    lastUsed: new Date(row.last_used),
  }))
}

export function getTrends(timeRange: TimeRange = "7d"): TrendDataPoint[] {
  const database = getDb()
  const since = getSinceDate(timeRange)
  const rows = database
    .query(
      `
    SELECT
      date(timestamp) as date,
      COUNT(*) as total_calls,
      AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
      AVG(duration_ms) as avg_duration
    FROM agent_metrics
    WHERE timestamp >= ?
    GROUP BY date(timestamp)
    ORDER BY date(timestamp)
  `,
    )
    .all(since.toISOString()) as Array<{
      date: string
      total_calls: number
      success_rate: number
      avg_duration: number
    }>

  return rows.map((row) => ({
    date: row.date,
    totalCalls: row.total_calls,
    successRate: row.success_rate,
    avgDurationMs: Math.round(row.avg_duration),
  }))
}

export function getOverallStats(timeRange: TimeRange = "7d"): {
  overallSuccessRate: number
  overallAvgDurationMs: number
  totalEvents: number
} {
  const database = getDb()
  const since = getSinceDate(timeRange)
  const row = database
    .query(
      `
    SELECT
      COUNT(*) as total_events,
      AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
      AVG(duration_ms) as avg_duration
    FROM agent_metrics
    WHERE timestamp >= ?
  `,
    )
    .get(since.toISOString()) as
    | {
        total_events: number
        success_rate: number
        avg_duration: number
      }
    | undefined

  if (!row) {
    return { overallSuccessRate: 0, overallAvgDurationMs: 0, totalEvents: 0 }
  }

  return {
    overallSuccessRate: row.success_rate ?? 0,
    overallAvgDurationMs: Math.round(row.avg_duration ?? 0),
    totalEvents: row.total_events,
  }
}

export function clearMetrics(timeRange: TimeRange = "all"): number {
  const database = getDb()
  if (timeRange === "all") {
    const result = database.run("DELETE FROM agent_metrics")
    return result.changes
  }
  const since = getSinceDate(timeRange)
  const result = database.run("DELETE FROM agent_metrics WHERE timestamp < ?", [
    since.toISOString(),
  ])
  return result.changes
}

function getSinceDate(timeRange: TimeRange): Date {
  const now = new Date()
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

export function closeAnalyticsDb(): void {
  if (db) {
    db.close()
    db = null
  }
}