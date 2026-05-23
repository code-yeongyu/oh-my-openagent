type BunDatabase = import("bun:sqlite").Database

import { join, dirname } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"

const DB_PATH = process.env.AGENT_ANALYTICS_DB_PATH ?? join(tmpdir(), "oh-my-opencode", "agent-analytics.db")

let db: BunDatabase | null = null

function getBunSqlite(): typeof import("bun:sqlite") | null {
  if (typeof globalThis.Bun === "undefined") {
    return null
  }
  try {
    const dynamicImport = new Function("return import('bun:sqlite')") as () => typeof import("bun:sqlite")
    return dynamicImport()
  } catch {
    return null
  }
}

export function getAnalyticsDb(): BunDatabase {
  if (db) return db

  const sqlite = getBunSqlite()
  if (!sqlite) {
    throw new Error("bun:sqlite is not available in this runtime")
  }

  const dbDir = dirname(DB_PATH)
  try {
    mkdirSync(dbDir, { recursive: true })
  } catch {
    // Directory may already exist
  }

  db = new sqlite.Database(DB_PATH)
  db.run("PRAGMA journal_mode = WAL")

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_metrics (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      category TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      duration_ms INTEGER,
      success INTEGER NOT NULL,
      error_type TEXT,
      token_count INTEGER
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_metrics_agent ON agent_metrics(agent_name)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_metrics_session ON agent_metrics(session_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON agent_metrics(timestamp)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_metrics_event_type ON agent_metrics(event_type)`)

  return db
}

export function closeAnalyticsDb(): void {
  if (db) {
    db.close()
    db = null
  }
}