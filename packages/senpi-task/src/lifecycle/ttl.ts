import type { TaskRecord } from "../state"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"
import type { CleanupResult } from "./types"

/**
 * Delete terminal records + logs older than task.ttl_ms. Non-terminal records are always kept. A
 * `lost` process record is NEVER deleted without pid-dead proof (its breadcrumbs may still be
 * needed). Records with a live resident handle in this process are also retained: deleting them
 * would orphan an in-memory handle and allow late transcript appends to recreate the deleted log.
 */
export function cleanupExpiredRecords(context: LifecycleContext): CleanupResult {
  const deleted: string[] = []
  const retained: string[] = []
  const cutoff = context.now() - context.config.ttl_ms

  for (const record of context.store.list().records) {
    if (isExpungeable(context, record, cutoff)) {
      context.store.remove(record.task_id)
      deleted.push(record.task_id)
    } else {
      retained.push(record.task_id)
    }
  }
  return { deleted, retained }
}

function isExpungeable(context: LifecycleContext, record: TaskRecord, cutoff: number): boolean {
  if (context.registry.get(record.task_id) !== undefined) return false
  if (!TERMINAL_STATUSES.has(record.status)) return false
  if (Date.parse(record.updated_at) > cutoff) return false
  if (record.status === "lost" && record.execution_mode === "process") {
    return record.pid !== undefined && !context.signaller.isAlive(record.pid)
  }
  return true
}
