import { Database } from "bun:sqlite"
import { join, dirname } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"

const DB_PATH = process.env.SEMANTIC_MEMORY_DB_PATH ?? join(tmpdir(), "oh-my-opencode", "semantic-memory.db")

let db: Database | null = null

export function getMemoryDb(): Database {
  if (db) return db

  // Ensure directory exists
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
      access_count INTEGER NOT NULL DEFAULT 0
    )
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_name)
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)
  `)

  return db
}

export function closeMemoryDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
