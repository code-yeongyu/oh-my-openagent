import type { ResidencyState, TaskRecord } from "../state"
import { TERMINAL_STATUSES } from "./context"

/**
 * THE revival population and admission order, shared by the session-start reconcile, batch
 * admission and anything that wants to know ahead of time which suspended children a resumed
 * session will revive (omo's host pre-warm).
 */

export type SuspendedResidency = Extract<ResidencyState, "persisted_only" | "rpc_detached">

// `interrupted` is terminal by status, but stays revivable for in-flight session recovery.
const REVIVABLE_STATUSES = new Set(["pending", "running", "interrupted"])

// Both the "unlimited" literal and a 0 cap mean unbounded residency (omo.json accepts either).
export function isUnboundedResidency(maxChildren: number | "unlimited"): maxChildren is "unlimited" | 0 {
  return maxChildren === "unlimited" || maxChildren === 0
}

export function isSuspendedResidency(state: ResidencyState): state is SuspendedResidency {
  return state === "persisted_only" || state === "rpc_detached"
}

export function isRevivalCandidate(record: TaskRecord, parentSessionId: string): boolean {
  return record.parent_session_id === parentSessionId
    && isSuspendedResidency(record.residency_state)
    && REVIVABLE_STATUSES.has(record.status)
    && record.killed !== true
}

export function residentsOf(records: readonly TaskRecord[], parentSessionId: string): readonly TaskRecord[] {
  return records.filter((record) => record.parent_session_id === parentSessionId && record.residency_state === "resident")
}

export type RevivalSelection = {
  readonly selected: readonly TaskRecord[]
  readonly deferred: readonly TaskRecord[]
}

/**
 * Which candidates one admission batch revives. Non-terminal before terminal, then most recently
 * updated, tie-break task_id; the cap counts current residents (live foreign owners included), so a
 * cap already reached revives none.
 */
export function selectRevivalBatch(
  records: readonly TaskRecord[],
  parentSessionId: string,
  maxChildren: number | "unlimited",
  excludeTaskIds?: ReadonlySet<string>,
): RevivalSelection {
  const candidates = byRevivalPriority(
    records.filter((record) => !excludeTaskIds?.has(record.task_id) && isRevivalCandidate(record, parentSessionId)),
  )
  const available = isUnboundedResidency(maxChildren)
    ? candidates.length
    : Math.max(0, maxChildren - residentsOf(records, parentSessionId).length)
  return { selected: candidates.slice(0, available), deferred: candidates.slice(available) }
}

function byRevivalPriority(records: readonly TaskRecord[]): readonly TaskRecord[] {
  return [...records].toSorted((left, right) => {
    const terminality = Number(TERMINAL_STATUSES.has(left.status)) - Number(TERMINAL_STATUSES.has(right.status))
    if (terminality !== 0) return terminality
    const recency = right.updated_at.localeCompare(left.updated_at)
    return recency !== 0 ? recency : left.task_id.localeCompare(right.task_id)
  })
}
