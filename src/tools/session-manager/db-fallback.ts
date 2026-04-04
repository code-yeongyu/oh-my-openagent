import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { getDataDir } from "../../shared/data-path"
import { log } from "../../shared"
import type { SessionMessage, SessionMetadata, TodoItem } from "./types"

function dbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

function open(): InstanceType<typeof Database> | null {
  const p = dbPath()
  if (!existsSync(p)) return null
  try {
    return new Database(p, { readonly: true })
  } catch (error) {
    log("[session-db-fallback] Failed to open DB", { error: String(error) })
    return null
  }
}

function withDb<T>(fallback: T, fn: (db: InstanceType<typeof Database>) => T): T {
  const db = open()
  if (!db) return fallback
  try {
    return fn(db)
  } catch (error) {
    log("[session-db-fallback] DB query failed", { error: String(error) })
    return fallback
  } finally {
    db.close()
  }
}

export function dbSessionExists(id: string): boolean {
  return withDb(false, (db) => {
    const row = db.prepare("SELECT 1 FROM session WHERE id = ?").get(id)
    return row !== null
  })
}

export function dbGetMainSessions(directory?: string): SessionMetadata[] {
  return withDb([], (db) => {
    const sql = directory
      ? "SELECT id, project_id, parent_id, directory, title, version, time_created, time_updated, summary_additions, summary_deletions, summary_files FROM session WHERE parent_id IS NULL AND directory = ? ORDER BY time_updated DESC LIMIT 100"
      : "SELECT id, project_id, parent_id, directory, title, version, time_created, time_updated, summary_additions, summary_deletions, summary_files FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 100"
    const rows = (directory ? db.prepare(sql).all(directory) : db.prepare(sql).all()) as Array<{
      id: string
      project_id: string
      parent_id: string | null
      directory: string
      title: string
      version: string
      time_created: number
      time_updated: number
      summary_additions: number | null
      summary_deletions: number | null
      summary_files: number | null
    }>
    return rows.map((row) => ({
      id: row.id,
      projectID: row.project_id,
      parentID: row.parent_id ?? undefined,
      directory: row.directory,
      title: row.title,
      version: row.version,
      time: { created: row.time_created, updated: row.time_updated },
      summary:
        row.summary_additions !== null
          ? { additions: row.summary_additions, deletions: row.summary_deletions ?? 0, files: row.summary_files ?? 0 }
          : undefined,
    }))
  })
}

export function dbGetAllSessionIds(): string[] {
  return withDb([], (db) => {
    const rows = db.prepare("SELECT id FROM session ORDER BY time_updated DESC").all() as Array<{ id: string }>
    return rows.map((r) => r.id)
  })
}

export function dbReadMessages(sid: string): SessionMessage[] {
  return withDb([], (db) => {
    const msgs = db
      .prepare("SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created, id")
      .all(sid) as Array<{ id: string; data: string; time_created: number }>

    const parts = db
      .prepare("SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY id")
      .all(sid) as Array<{ id: string; message_id: string; data: string }>

    const grouped = new Map<string, typeof parts>()
    for (const p of parts) {
      const arr = grouped.get(p.message_id)
      if (arr) arr.push(p)
      else grouped.set(p.message_id, [p])
    }

    const result: SessionMessage[] = []
    for (const msg of msgs) {
      let info: Record<string, unknown>
      try {
        info = JSON.parse(msg.data)
      } catch {
        continue
      }
      const parsed = (grouped.get(msg.id) ?? []).map((p) => {
        try {
          const pd = JSON.parse(p.data) as Record<string, unknown>
          const state = pd.state as Record<string, unknown> | undefined
          return {
            id: p.id,
            type: (pd.type as string) || "text",
            text: pd.text as string | undefined,
            thinking: pd.thinking as string | undefined,
            tool: pd.tool as string | undefined,
            callID: pd.callID as string | undefined,
            input: state?.input as Record<string, unknown> | undefined,
            output:
              typeof state?.output === "string"
                ? state.output
                : state?.output
                  ? JSON.stringify(state.output)
                  : undefined,
            error: state?.error as string | undefined,
          }
        } catch {
          return { id: p.id, type: "text" }
        }
      })
      const time = info.time as { created?: number; updated?: number } | undefined
      result.push({
        id: msg.id,
        role: (info.role as "user" | "assistant") || "user",
        agent: info.agent as string | undefined,
        time: time?.created ? { created: time.created, updated: time.updated } : undefined,
        parts: parsed,
      })
    }
    return result
  })
}

export function dbReadTodos(sid: string): TodoItem[] {
  return withDb([], (db) => {
    const rows = db
      .prepare("SELECT content, status, priority FROM todo WHERE session_id = ? ORDER BY position")
      .all(sid) as Array<{ content: string; status: string; priority: string }>
    return rows.map((row) => ({
      content: row.content,
      status: row.status as TodoItem["status"],
      priority: row.priority,
    }))
  })
}
