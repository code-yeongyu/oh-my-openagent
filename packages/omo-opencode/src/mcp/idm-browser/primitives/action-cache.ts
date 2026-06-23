import { Database } from "bun:sqlite"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync } from "node:fs"

const CACHE_DIR = join(homedir(), "Library", "Caches", "idm", "browser")
const DB_PATH = join(CACHE_DIR, "action-cache.sqlite")

export type CachedAction = {
  instruction: string
  url_pattern: string
  selector: string
  created_at: number
  hit_count: number
}

export function createActionCache(dbPath = DB_PATH) {
  mkdirSync(CACHE_DIR, { recursive: true })

  const db = new Database(dbPath)
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
    CREATE TABLE IF NOT EXISTS action_cache (
      instruction TEXT NOT NULL,
      url_pattern TEXT NOT NULL,
      selector TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      hit_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (instruction, url_pattern)
    )
  `)

  function lookup(instruction: string, urlPattern: string): CachedAction | null {
    const row = db.query<CachedAction, [string, string]>(
      "SELECT * FROM action_cache WHERE instruction = ?1 AND url_pattern = ?2"
    ).get(instruction, urlPattern)

    if (row) {
      db.run(
        "UPDATE action_cache SET hit_count = hit_count + 1 WHERE instruction = ?1 AND url_pattern = ?2",
        [instruction, urlPattern]
      )
    }

    return row ?? null
  }

  function store(instruction: string, urlPattern: string, selector: string): void {
    db.run(
      `INSERT INTO action_cache (instruction, url_pattern, selector)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(instruction, url_pattern) DO UPDATE SET selector = ?3, hit_count = hit_count + 1`,
      [instruction, urlPattern, selector]
    )
  }

  function clear(): void {
    db.run("DELETE FROM action_cache")
  }

  function close(): void {
    db.close()
  }

  function size(): number {
    const row = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM action_cache").get()
    return row?.count ?? 0
  }

  return { lookup, store, clear, close, size }
}

export type ActionCache = ReturnType<typeof createActionCache>
