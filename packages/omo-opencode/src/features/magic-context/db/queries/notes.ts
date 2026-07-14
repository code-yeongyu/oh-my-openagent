/**
 * CRUD for the unified notes table.
 *
 * Ported from MC's storage-notes.ts.
 */

import type { Database } from "../sqlite"

export type NoteType = "session" | "smart"
export type NoteStatus =
  | "active"
  | "pending"
  | "ready"
  | "dismissed"

export interface Note {
  id: number
  type: NoteType
  status: NoteStatus
  content: string
  sessionId: string | null
  projectPath: string | null
  surfaceCondition: string | null
  createdAt: number
  updatedAt: number
  lastCheckedAt: number | null
  readyAt: number | null
  readyReason: string | null
  anchorOrdinal: number | null
}

export interface SessionNoteInput {
  sessionId: string
  content: string
  anchorOrdinal?: number | null
}

export interface SmartNoteInput {
  content: string
  sessionId?: string
  projectPath: string
  surfaceCondition: string
  anchorOrdinal?: number | null
}

// ── CRUD ──────────────────────────────────────────────────────

export function getNotes(
  db: Database,
  options: {
    sessionId?: string
    projectPath?: string
    type?: NoteType
    status?: NoteStatus | NoteStatus[]
  } = {},
): Note[] {
  const clauses: string[] = []
  const params: Array<string | NoteStatus> = []

  if (options.sessionId !== undefined) {
    clauses.push("session_id = ?")
    params.push(options.sessionId)
  }
  if (options.projectPath !== undefined) {
    clauses.push("project_path = ?")
    params.push(options.projectPath)
  }
  if (options.type !== undefined) {
    clauses.push("type = ?")
    params.push(options.type)
  }
  if (options.status !== undefined) {
    const statuses = Array.isArray(options.status)
      ? options.status
      : [options.status]
    if (statuses.length > 0) {
      const ph = statuses.map(() => "?").join(", ")
      clauses.push(`status IN (${ph})`)
      params.push(...statuses)
    }
  }

  const where =
    clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : ""
  const rows = (
    db
      .prepare(`SELECT * FROM notes${where} ORDER BY created_at ASC, id ASC`)
      .all(...params) as unknown[]
  ).filter(isNoteRow)

  return rows.map(toNote)
}

export function addSessionNote(
  db: Database,
  input: SessionNoteInput,
): Note {
  const now = Date.now()
  const result = db
    .prepare(
      "INSERT INTO notes (type, status, content, session_id, created_at, updated_at, harness, anchor_ordinal) VALUES ('session', 'active', ?, ?, ?, ?, 'opencode', ?) RETURNING *",
    )
    .get(input.content, input.sessionId, now, now, input.anchorOrdinal ?? null)

  if (!isNoteRow(result)) {
    throw new Error("[notes] failed to insert session note")
  }
  return toNote(result)
}

export function addSmartNote(
  db: Database,
  input: SmartNoteInput,
): Note {
  const now = Date.now()
  const result = db
    .prepare(
      "INSERT INTO notes (type, status, content, session_id, project_path, surface_condition, created_at, updated_at, harness, anchor_ordinal) VALUES ('smart', 'pending', ?, ?, ?, ?, ?, ?, 'opencode', ?) RETURNING *",
    )
    .get(
      input.content,
      input.sessionId ?? null,
      input.projectPath,
      input.surfaceCondition,
      now,
      now,
      input.anchorOrdinal ?? null,
    )

  if (!isNoteRow(result)) {
    throw new Error("[notes] failed to insert smart note")
  }
  return toNote(result)
}

export function updateNote(
  db: Database,
  noteId: number,
  updates: {
    content?: string
    status?: NoteStatus
    sessionId?: string | null
    projectPath?: string | null
    surfaceCondition?: string | null
    lastCheckedAt?: number | null
    readyAt?: number | null
    readyReason?: string | null
  },
): Note | null {
  const now = Date.now()
  const sets: string[] = ["updated_at = ?"]
  const params: Array<string | number | null> = [now]

  if (updates.content !== undefined) {
    sets.push("content = ?")
    params.push(updates.content)
  }
  if (updates.status !== undefined) {
    sets.push("status = ?")
    params.push(updates.status)
  }
  if (updates.sessionId !== undefined) {
    sets.push("session_id = ?")
    params.push(updates.sessionId)
  }
  if (updates.projectPath !== undefined) {
    sets.push("project_path = ?")
    params.push(updates.projectPath)
  }
  if (updates.surfaceCondition !== undefined) {
    sets.push("surface_condition = ?")
    params.push(updates.surfaceCondition)
  }
  if (updates.lastCheckedAt !== undefined) {
    sets.push("last_checked_at = ?")
    params.push(updates.lastCheckedAt)
  }
  if (updates.readyAt !== undefined) {
    sets.push("ready_at = ?")
    params.push(updates.readyAt)
  }
  if (updates.readyReason !== undefined) {
    sets.push("ready_reason = ?")
    params.push(updates.readyReason)
  }

  if (sets.length === 1) return null

  params.push(noteId)
  const result = db
    .prepare(
      `UPDATE notes SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
    )
    .get(...params)

  return isNoteRow(result) ? toNote(result) : null
}

export function dismissNote(
  db: Database,
  noteId: number,
): boolean {
  const result = db
    .prepare(
      "UPDATE notes SET status = 'dismissed', updated_at = ? WHERE id = ? AND status != 'dismissed'",
    )
    .run(Date.now(), noteId)
  return result.changes > 0
}

export function markNoteReady(
  db: Database,
  noteId: number,
  reason?: string,
): void {
  const now = Date.now()
  db.prepare(
    "UPDATE notes SET status = 'ready', ready_at = ?, ready_reason = ?, updated_at = ?, last_checked_at = ? WHERE id = ? AND type = 'smart'",
  ).run(now, reason ?? null, now, now, noteId)
}

export function markNoteChecked(
  db: Database,
  noteId: number,
): void {
  const now = Date.now()
  db.prepare(
    "UPDATE notes SET last_checked_at = ?, updated_at = ? WHERE id = ? AND type = 'smart'",
  ).run(now, now, noteId)
}

export function deleteNote(
  db: Database,
  noteId: number,
): boolean {
  const result = db.prepare("DELETE FROM notes WHERE id = ?").run(noteId)
  return result.changes > 0
}

export function replaceAllSessionNotes(
  db: Database,
  sessionId: string,
  notes: string[],
): void {
  const now = Date.now()
  db.transaction(() => {
    db.prepare(
      "DELETE FROM notes WHERE session_id = ? AND type = 'session'",
    ).run(sessionId)
    const insert = db.prepare(
      "INSERT INTO notes (type, status, content, session_id, created_at, updated_at, harness) VALUES ('session', 'active', ?, ?, ?, ?, 'opencode')",
    )
    for (const note of notes) {
      insert.run(note, sessionId, now, now)
    }
  })()
}

// ── Helpers ───────────────────────────────────────────────────

interface NoteRow {
  id: number
  type: string
  status: string
  content: string
  session_id: string | null
  project_path: string | null
  surface_condition: string | null
  created_at: number
  updated_at: number
  last_checked_at: number | null
  ready_at: number | null
  ready_reason: string | null
  anchor_ordinal?: number | null
}

const NOTE_TYPES = new Set<NoteType>(["session", "smart"])
const NOTE_STATUSES = new Set<NoteStatus>([
  "active",
  "pending",
  "ready",
  "dismissed",
])

function isNoteRow(row: unknown): row is NoteRow {
  if (row === null || typeof row !== "object") return false
  const c = row as Record<string, unknown>
  return (
    typeof c.id === "number" &&
    typeof c.type === "string" &&
    NOTE_TYPES.has(c.type as NoteType) &&
    typeof c.status === "string" &&
    NOTE_STATUSES.has(c.status as NoteStatus) &&
    typeof c.content === "string" &&
    typeof c.created_at === "number" &&
    typeof c.updated_at === "number"
  )
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    type: row.type as NoteType,
    status: row.status as NoteStatus,
    content: row.content,
    sessionId:
      typeof row.session_id === "string" && row.session_id.length > 0
        ? row.session_id
        : null,
    projectPath:
      typeof row.project_path === "string" && row.project_path.length > 0
        ? row.project_path
        : null,
    surfaceCondition:
      typeof row.surface_condition === "string" &&
      row.surface_condition.length > 0
        ? row.surface_condition
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt:
      typeof row.last_checked_at === "number" ? row.last_checked_at : null,
    readyAt: typeof row.ready_at === "number" ? row.ready_at : null,
    readyReason:
      typeof row.ready_reason === "string" && row.ready_reason.length > 0
        ? row.ready_reason
        : null,
    anchorOrdinal:
      typeof row.anchor_ordinal === "number" ? row.anchor_ordinal : null,
  }
}
