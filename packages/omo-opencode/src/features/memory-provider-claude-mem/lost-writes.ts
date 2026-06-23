import type { Database } from "bun:sqlite"
import { tableHasColumn } from "./table-column"
import type { LostWriteRow } from "./types"

export function getLostWritesFromDb(db: Database, contentSessionId: string): LostWriteRow[] {
  const createdAtExpression = tableHasColumn(db, "pending_messages", "created_at")
    ? "created_at"
    : "datetime(created_at_epoch / 1000, 'unixepoch')"

  return db.query(`
    SELECT id, tool_name, status, ${createdAtExpression} AS created_at
    FROM pending_messages
    WHERE content_session_id = ? AND status = 'failed'
    ORDER BY created_at DESC
  `).all(contentSessionId) as LostWriteRow[]
}
