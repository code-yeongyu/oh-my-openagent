import type { TaskRecord } from "../state"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"
import type { CleanupResult } from "./types"

/**
 * On component start, delete terminal records + logs older than task.ttl_ms. Non-terminal records
 * are always kept. A `lost` rpc record is NEVER deleted without pid-dead proof (its breadcrumbs may
 * still be needed). Because this runs at start, fresh in-run records are far younger than the TTL,
 * so evidence-referenced logs of the current run are never touched.
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
  if (!TERMINAL_STATUSES.has(record.status)) return false
  if (Date.parse(record.updated_at) > cutoff) return false
  if (record.status === "lost" && record.execution_mode === "process") {
    return record.pid !== undefined && !context.signaller.isAlive(record.pid)
  }
  return true
}
