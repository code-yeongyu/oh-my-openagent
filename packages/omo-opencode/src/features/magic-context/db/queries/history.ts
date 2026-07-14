/**
 * CRUD for message_history_index and message_history_fts.
 *
 * Ported from MC's message-index.ts.
 */

import type { Database } from "../sqlite"

export interface MessageIndexRow {
  sessionId: string
  lastIndexedOrdinal: number
  dirtyFloorOrdinal: number
  updatedAt: number
}

export function getLastIndexedOrdinal(
  db: Database,
  sessionId: string,
): number {
  const row = db
    .prepare(
      "SELECT last_indexed_ordinal, dirty_floor_ordinal FROM message_history_index WHERE session_id = ?",
    )
    .get(sessionId) as {
    last_indexed_ordinal?: number
    dirty_floor_ordinal?: number
  } | null
  return typeof row?.last_indexed_ordinal === "number"
    ? row.last_indexed_ordinal
    : 0
}

export function getDirtyFloorOrdinal(
  db: Database,
  sessionId: string,
): number | null {
  const row = db
    .prepare(
      "SELECT dirty_floor_ordinal FROM message_history_index WHERE session_id = ?",
    )
    .get(sessionId) as { dirty_floor_ordinal?: number } | null
  return typeof row?.dirty_floor_ordinal === "number" &&
    row.dirty_floor_ordinal > 0
    ? row.dirty_floor_ordinal
    : null
}

export function upsertIndex(
  db: Database,
  sessionId: string,
  lastIndexedOrdinal: number,
): void {
  db.prepare(
    "INSERT INTO message_history_index (session_id, last_indexed_ordinal, updated_at, harness) VALUES (?, ?, ?, 'opencode') ON CONFLICT(session_id) DO UPDATE SET last_indexed_ordinal = excluded.last_indexed_ordinal, updated_at = excluded.updated_at",
  ).run(sessionId, lastIndexedOrdinal, Date.now())
}

export function upsertCleanIndex(
  db: Database,
  sessionId: string,
  lastIndexedOrdinal: number,
): void {
  db.prepare(
    "INSERT INTO message_history_index (session_id, last_indexed_ordinal, dirty_floor_ordinal, updated_at, harness) VALUES (?, ?, 0, ?, 'opencode') ON CONFLICT(session_id) DO UPDATE SET last_indexed_ordinal = excluded.last_indexed_ordinal, dirty_floor_ordinal = 0, updated_at = excluded.updated_at",
  ).run(sessionId, lastIndexedOrdinal, Date.now())
}

export function markMessageIndexDirty(
  db: Database,
  sessionId: string,
  floorOrdinal: number,
): void {
  const dirtyFloor = Math.max(1, Math.floor(floorOrdinal))
  const current = getLastIndexedOrdinal(db, sessionId)
  db.prepare(
    `INSERT INTO message_history_index (session_id, last_indexed_ordinal, dirty_floor_ordinal, updated_at, harness)
     VALUES (?, ?, ?, ?, 'opencode')
     ON CONFLICT(session_id) DO UPDATE SET
       last_indexed_ordinal = MAX(message_history_index.last_indexed_ordinal, excluded.last_indexed_ordinal),
       dirty_floor_ordinal = CASE
         WHEN message_history_index.dirty_floor_ordinal <= 0 THEN excluded.dirty_floor_ordinal
         WHEN excluded.dirty_floor_ordinal <= 0 THEN message_history_index.dirty_floor_ordinal
         ELSE MIN(message_history_index.dirty_floor_ordinal, excluded.dirty_floor_ordinal)
       END,
       updated_at = excluded.updated_at`,
  ).run(sessionId, current, dirtyFloor, Date.now())
}

export function deleteIndexedMessages(
  db: Database,
  sessionId: string,
): void {
  db.transaction(() => {
    db.prepare(
      "DELETE FROM message_history_fts WHERE session_id = ?",
    ).run(sessionId)
    db.prepare(
      "DELETE FROM message_history_index WHERE session_id = ?",
    ).run(sessionId)
  })()
}

export function getIndexableContent(
  role: string,
  parts: unknown[],
): string {
  if (role === "user" || role === "assistant") {
    const textParts = extractTexts(parts)
    return textParts
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 0)
      .join(" / ")
  }
  return ""
}

function extractTexts(parts: unknown[]): string[] {
  const texts: string[] = []
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      "text" in (part as Record<string, unknown>)
    ) {
      const t = (part as Record<string, unknown>).text
      if (typeof t === "string") texts.push(t)
    }
  }
  return texts
}
