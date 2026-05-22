import { Database } from "bun:sqlite"
import { join, dirname } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"

const DB_PATH = process.env.AUTO_EVALUATION_DB_PATH ?? join(tmpdir(), "oh-my-opencode", "auto-evaluation.db")

let db: Database | null = null

export function getEvaluationDb(): Database {
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
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      category TEXT,
      task_description TEXT,
      completion_score REAL NOT NULL,
      efficiency_score REAL NOT NULL,
      quality_score REAL NOT NULL,
      tool_usage_score REAL NOT NULL,
      overall_score REAL NOT NULL,
      tool_calls_count INTEGER NOT NULL DEFAULT 0,
      successful_tool_calls INTEGER NOT NULL DEFAULT 0,
      failed_tool_calls INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      token_usage INTEGER,
      error_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      completion_status TEXT NOT NULL DEFAULT 'unknown',
      feedback TEXT,
      evaluated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_evaluations_agent ON evaluations(agent_name)
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_evaluations_session ON evaluations(session_id)
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_evaluations_category ON evaluations(category)
  `)

  return db
}

export function closeEvaluationDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
