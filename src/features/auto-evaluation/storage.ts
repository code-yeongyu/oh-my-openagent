type BunDatabase = import("bun:sqlite").Database

import { join, dirname } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"

const DB_PATH = process.env.AUTO_EVALUATION_DB_PATH ?? join(tmpdir(), "oh-my-opencode", "auto-evaluation.db")

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

export function getEvaluationDb(): BunDatabase {
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
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      category TEXT,
      task_description TEXT,
      completion_score REAL NOT NULL,
      quality_score REAL NOT NULL,
      efficiency_score REAL NOT NULL,
      error_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL,
      todos_completed INTEGER NOT NULL DEFAULT 0,
      todos_total INTEGER NOT NULL DEFAULT 0,
      feedback TEXT,
      evaluated_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_evaluations_agent ON evaluations(agent_name)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_evaluations_category ON evaluations(category)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_evaluations_session ON evaluations(session_id)`)

  return db
}

export function closeEvaluationDb(): void {
  if (db) {
    db.close()
    db = null
  }
}