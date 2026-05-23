import { Database } from "bun:sqlite"
import { join, dirname } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"
import { CostEntry, CostBudget, BudgetAlert } from "./types"

const DB_PATH = process.env.COST_TRACKING_DB_PATH ?? join(tmpdir(), "oh-my-opencode", "cost-tracking.db")

let db: Database | null = null

export function getCostDb(): Database {
  if (db) return db

  const dbDir = dirname(DB_PATH)
  try {
    mkdirSync(dbDir, { recursive: true })
  } catch {
    // Directory may already exist
  }

  db = new Database(DB_PATH)
  db.run("PRAGMA journal_mode = WAL")

  db.run(`
    CREATE TABLE IF NOT EXISTS cost_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      model_used TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL,
      tool_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS cost_budgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      limit_usd REAL NOT NULL,
      period TEXT NOT NULL DEFAULT 'monthly',
      alert_threshold REAL NOT NULL DEFAULT 80,
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS budget_alerts (
      id TEXT PRIMARY KEY,
      threshold_usd REAL NOT NULL,
      current_spend_usd REAL NOT NULL,
      exceeded INTEGER NOT NULL DEFAULT 0,
      session_id TEXT,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_cost_entries_session ON cost_entries(session_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_cost_entries_timestamp ON cost_entries(timestamp)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_cost_entries_model ON cost_entries(model_used)`)

  return db
}

export function closeCostDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function insertCostEntry(entry: CostEntry): void {
  const d = getCostDb()
  d.run(
    `INSERT INTO cost_entries (id, session_id, agent_name, model_used, input_tokens, output_tokens, cost_usd, tool_name, category, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.sessionId,
      entry.agentName,
      entry.modelUsed,
      entry.inputTokens,
      entry.outputTokens,
      entry.costUsd,
      entry.toolName,
      entry.category,
      entry.timestamp.getTime(),
    ],
  )
}

export function getSessionCost(sessionId: string): number {
  const d = getCostDb()
  const row = d.query(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE session_id = ?`).get(sessionId) as { total: number } | undefined
  return row?.total ?? 0
}

export function getTotalCostSince(timestamp: number): number {
  const d = getCostDb()
  const row = d.query(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE timestamp >= ?`).get(timestamp) as { total: number } | undefined
  return row?.total ?? 0
}

export function getCostByAgent(since: number): Record<string, number> {
  const d = getCostDb()
  const rows = d.query(
    `SELECT agent_name, COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE timestamp >= ? GROUP BY agent_name ORDER BY total DESC`,
  ).all(since) as Array<{ agent_name: string; total: number }>
  const result: Record<string, number> = {}
  for (const r of rows) result[r.agent_name] = r.total
  return result
}

export function getCostByModel(since: number): Record<string, number> {
  const d = getCostDb()
  const rows = d.query(
    `SELECT model_used, COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE timestamp >= ? GROUP BY model_used ORDER BY total DESC`,
  ).all(since) as Array<{ model_used: string; total: number }>
  const result: Record<string, number> = {}
  for (const r of rows) result[r.model_used] = r.total
  return result
}

export function insertBudget(budget: CostBudget): void {
  const d = getCostDb()
  d.run(
    `INSERT OR REPLACE INTO cost_budgets (id, name, limit_usd, period, alert_threshold, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [budget.id, budget.name, budget.limitUsd, budget.period, budget.alertThreshold, budget.enabled ? 1 : 0],
  )
}

export function getBudgets(): CostBudget[] {
  const d = getCostDb()
  const rows = d.query(`SELECT * FROM cost_budgets`).all() as Array<{
    id: string; name: string; limit_usd: number; period: string; alert_threshold: number; enabled: number
  }>
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    limitUsd: r.limit_usd,
    period: r.period as CostBudget["period"],
    alertThreshold: r.alert_threshold,
    currentSpendUsd: 0,
    enabled: r.enabled === 1,
  }))
}

export function insertAlert(alert: BudgetAlert): void {
  const d = getCostDb()
  d.run(
    `INSERT INTO budget_alerts (id, threshold_usd, current_spend_usd, exceeded, session_id, notified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [alert.id, alert.thresholdUsd, alert.currentSpendUsd, alert.exceeded ? 1 : 0, alert.sessionId ?? null, alert.notified ? 1 : 0, alert.createdAt.getTime()],
  )
}

export function getRecentAlerts(limit = 10): BudgetAlert[] {
  const d = getCostDb()
  const rows = d.query(
    `SELECT * FROM budget_alerts ORDER BY created_at DESC LIMIT ?`,
  ).all(limit) as Array<{
    id: string; threshold_usd: number; current_spend_usd: number; exceeded: number; session_id: string | null; notified: number; created_at: number
  }>
  return rows.map(r => ({
    id: r.id,
    thresholdUsd: r.threshold_usd,
    currentSpendUsd: r.current_spend_usd,
    exceeded: r.exceeded === 1,
    sessionId: r.session_id ?? undefined,
    notified: r.notified === 1,
    createdAt: new Date(r.created_at),
  }))
}

export function clearCostData(): void {
  const d = getCostDb()
  d.run("DELETE FROM cost_entries")
  d.run("DELETE FROM cost_budgets")
  d.run("DELETE FROM budget_alerts")
}
