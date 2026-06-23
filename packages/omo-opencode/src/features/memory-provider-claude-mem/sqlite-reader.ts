import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { getLostWritesFromDb } from "./lost-writes"
import { readQueueBacklog, type QueueBacklogStats } from "./queue-backlog"
import {
  searchObservationsFromDb,
  type SearchObservationsOptions,
} from "./search-observations"
import type {
  LostWriteRow,
  ObservationRow,
  SessionRow,
  SessionSummaryRow,
  SQLiteReaderConfig,
} from "./types"

const DEFAULT_DB_PATH = join(homedir(), ".claude-mem", "claude-mem.db")

export class ClaudeMemSQLiteReaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ClaudeMemSQLiteReaderError"
  }
}

export interface PromotionCandidateOptions {
  project?: string
  min_discovery_tokens?: number
  limit?: number
  since?: string
}

export class ClaudeMemSQLiteReader {
  private db: Database | undefined

  constructor(private readonly config: Partial<SQLiteReaderConfig> = {}) {}

  private getDb(): Database {
    if (this.db) return this.db
    const dbPath = this.config.dbPath ?? DEFAULT_DB_PATH
    if (!existsSync(dbPath)) {
      throw new ClaudeMemSQLiteReaderError(
        `claude-mem database not found at ${dbPath}`,
      )
    }
    this.db = new Database(dbPath, { readonly: true })
    return this.db
  }

  close(): void {
    this.db?.close()
    this.db = undefined
  }

  isAvailable(): boolean {
    const dbPath = this.config.dbPath ?? DEFAULT_DB_PATH
    return existsSync(dbPath)
  }

  searchObservations(
    query: string,
    options: SearchObservationsOptions = {},
  ) {
    return searchObservationsFromDb(this.getDb(), query, options)
  }

  getSession(contentSessionId: string): SessionRow | null {
    const db = this.getDb()
    return db
      .query(
        "SELECT * FROM sdk_sessions WHERE content_session_id = ? LIMIT 1",
      )
      .get(contentSessionId) as SessionRow | null
  }

  getSessionSummary(memorySessionId: string): SessionSummaryRow | null {
    const db = this.getDb()
    return db
      .query(
        "SELECT * FROM session_summaries WHERE memory_session_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(memorySessionId) as SessionSummaryRow | null
  }

  getSessionObservations(
    memorySessionId: string,
    limit = 10,
  ): ObservationRow[] {
    const db = this.getDb()
    return db
      .query(
        "SELECT * FROM observations WHERE memory_session_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(memorySessionId, limit) as ObservationRow[]
  }

  getPromotionCandidates(
    options: PromotionCandidateOptions = {},
  ): ObservationRow[] {
    const db = this.getDb()
    const limit = options.limit ?? 20
    const minTokens = options.min_discovery_tokens ?? 100
    const params: (string | number)[] = ["decision", "discovery", minTokens]
    const conditions = [
      "o.type IN (?, ?) AND COALESCE(o.discovery_tokens, 0) >= ?",
    ]

    if (options.project) {
      conditions.push("o.project = ?")
      params.push(options.project)
    }
    if (options.since) {
      conditions.push("o.created_at > ?")
      params.push(options.since)
    }
    params.push(limit)

    const sql = `
      SELECT * FROM observations o
      WHERE ${conditions.join(" AND ")}
      ORDER BY o.discovery_tokens DESC, o.created_at DESC
      LIMIT ?
    `
    return db.query(sql).all(...params) as ObservationRow[]
  }

  getLostWrites(contentSessionId: string): LostWriteRow[] {
    return getLostWritesFromDb(this.getDb(), contentSessionId)
  }

  getQueueBacklog(): QueueBacklogStats {
    return readQueueBacklog(this.getDb())
  }
}
