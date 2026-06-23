import type { Database } from "bun:sqlite"

export interface QueueBacklogStats {
  total: number
  pending: number
  processing: number
  failed: number
  worstSessionId?: string
  worstSessionCount: number
  oldestPendingEpoch?: number
}

export function readQueueBacklog(db: Database): QueueBacklogStats {
  const statusCounts = db
    .query("SELECT status, COUNT(*) as count FROM pending_messages GROUP BY status")
    .all() as Array<{ status: string; count: number }>

  const counts: Record<string, number> = {}
  let total = 0
  for (const row of statusCounts) {
    counts[row.status] = row.count
    total += row.count
  }

  const worstSession = db.query(`
    SELECT content_session_id, COUNT(*) as count
    FROM pending_messages
    WHERE status IN ('pending', 'processing')
    GROUP BY content_session_id
    ORDER BY count DESC
    LIMIT 1
  `).get() as { content_session_id: string; count: number } | null

  const oldestPending = db.query(`
    SELECT created_at_epoch
    FROM pending_messages
    WHERE status = 'pending'
    ORDER BY created_at_epoch ASC
    LIMIT 1
  `).get() as { created_at_epoch: number } | null

  return {
    total,
    pending: counts.pending ?? 0,
    processing: counts.processing ?? 0,
    failed: counts.failed ?? 0,
    worstSessionId: worstSession?.content_session_id,
    worstSessionCount: worstSession?.count ?? 0,
    oldestPendingEpoch: oldestPending?.created_at_epoch,
  }
}
