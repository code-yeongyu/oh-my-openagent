import type { TaskRecord } from "../state"
import { isProcessPid } from "../state/pid"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { AgentLimitReached } from "./errors"
import type { AdmissionResult } from "./types"

/**
 * Residency cap gate (codex residency contract). A resident is a spawned-not-disposed child of the
 * parent session. Under the cap -> admit. At the cap -> LRU-evict the OLDEST terminal, idle resident
 * (skipping any with a queued send) via the destruction port. If nothing is evictable -> reject with
 * AgentLimitReached naming the residents so the caller can explain why.
 */
export async function admitResident(context: LifecycleContext, parentSessionId: string): Promise<AdmissionResult> {
  const residents = residentsFor(context, parentSessionId)
  if (residents.length < context.config.residency_max_children) return { kind: "admitted" }

  const victim = lruEvictable(context, residents)
  if (victim === undefined) {
    return {
      kind: "rejected",
      error: new AgentLimitReached({
        max_children: context.config.residency_max_children,
        session_id: parentSessionId,
        residents: residents.map((record) => ({ task_id: record.task_id, name: record.name ?? record.task_id, status: record.status })),
      }),
    }
  }

  await destroyResidentTask(context, victim.task_id, "evict")
  return { kind: "evicted", evicted_task_id: victim.task_id }
}

function residentsFor(context: LifecycleContext, parentSessionId: string): readonly TaskRecord[] {
  return context.store
    .list()
    .records.filter((record) => record.parent_session_id === parentSessionId && record.residency_state === "resident")
}

// Oldest-first scan (updated_at is touched on every steer/revive, so it tracks recency of use). The
// first terminal resident with no pending send is the LRU victim. EVERY terminal status (including
// lost and cancelled) is reclaimable: a lost child is unreachable and must never pin a slot.
function lruEvictable(context: LifecycleContext, residents: readonly TaskRecord[]): TaskRecord | undefined {
  return [...residents]
    .filter(
      (record) =>
        TERMINAL_STATUSES.has(record.status) &&
        !context.registry.hasPendingSends(record.task_id) &&
        !hasHandlelessLiveProcess(context, record),
    )
    .toSorted((left, right) => left.updated_at.localeCompare(right.updated_at))[0]
}

function hasHandlelessLiveProcess(context: LifecycleContext, record: TaskRecord): boolean {
  const pid = record.pid
  if (record.execution_mode !== "process" || pid === undefined || !isProcessPid(pid)) return false
  if (context.registry.get(record.task_id) !== undefined) return false
  return context.signaller.isAlive(pid)
}
