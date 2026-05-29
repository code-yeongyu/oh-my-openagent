import { Database } from "bun:sqlite"
import { join, dirname } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"

const DB_PATH = process.env.SEMANTIC_MEMORY_DB_PATH ?? join(tmpdir(), "oh-my-opencode", "semantic-memory.db")

let db: Database | null = null

export function getMemoryDb(): Database {
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
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      agent_name TEXT,
      session_id TEXT,
      memory_type TEXT NOT NULL DEFAULT 'context',
      importance REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      symbol_name TEXT,
      ast_pattern TEXT,
      before_content TEXT,
      after_content TEXT
    )
  `)

  // Migrate existing tables if they don't have the new AFT columns
  const columns = ["file_path", "symbol_name", "ast_pattern", "before_content", "after_content"]
  for (const col of columns) {
    try {
      db.run(`ALTER TABLE memories ADD COLUMN ${col} TEXT`)
    } catch {
      // Column may already exist, ignore safely
    }
  }

  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_name)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)`)

  return db
}

export function closeMemoryDb(): void {
  if (db) {
    db.close()
    db = null
  }
}