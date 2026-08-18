import type { TaskRecord } from "../state"
import { acquireSessionAdmissionLease, type AdmissionLeaseTiming } from "./admission-lease"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
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
  const maxChildren = context.config.residency_max_children
  if (maxChildren === "unlimited" || residents.length < maxChildren) return { kind: "admitted" }

  const victim = lruEvictable(context, residents)
  if (victim === undefined) {
    return {
      kind: "rejected",
      error: new AgentLimitReached({
        max_children: maxChildren,
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
    .filter((record) => TERMINAL_STATUSES.has(record.status) && !context.registry.hasPendingSends(record.task_id))
    .toSorted((left, right) => left.updated_at.localeCompare(right.updated_at))[0]
}

// --- Reconciliation batch admission (session-resume revival) -----------------------------
// Governs ONLY records needing a NEW residency slot (persisted_only / rpc_detached). Already-
// resident orphan reclamation bypasses this path entirely and is never capacity-gated. The whole
// batch runs under the per-parent-session admission lease (admission-lease.ts); the critical
// section contains ONLY record reads and store.mutate claims - no respawn I/O, no filesystem
// deletion, no process spawning - so it stays short by construction.

const SUSPENDED_RESIDENCIES = new Set(["persisted_only", "rpc_detached"])
const REVIVABLE_STATUSES = new Set(["pending", "running", "completed", "error", "interrupted"])

export type BatchAdmissionDeferral = "capacity" | "lock_contended" | "foreign_live_owner" | "lease_lost"

export type BatchAdmissionOutcome =
  | { readonly task_id: string; readonly kind: "claimed" }
  | { readonly task_id: string; readonly kind: "deferred"; readonly reason: BatchAdmissionDeferral }

export type BatchAdmissionResult = {
  readonly lease: "acquired" | "lock_contended" | "lease_lost"
  readonly outcomes: readonly BatchAdmissionOutcome[]
}

export type BatchAdmissionOptions = {
  readonly timing?: Partial<AdmissionLeaseTiming>
  // Test seam for deterministic displacement/contention; production uses the real lease.
  readonly acquireLease?: typeof acquireSessionAdmissionLease
  // Records this reconciliation pass has already classified as unsafe to admit (for example, a
  // terminal no-transcript record whose disposal lock contended). They remain suspended for retry.
  readonly excludeTaskIds?: ReadonlySet<string>
}

export type ResidencyClaimResult = "claimed" | "not_claimable"

// The per-record expected-state CAS (todo 13's ownership primitive): the claim lands ONLY if the
// fresh record still satisfies `expect` inside the store's locked read-modify-write, and stamps
// residency resident + this host's pid in the same write. Batch admission expects a still-
// suspended record; orphan reclamation expects the observed dead/self owner.
export function claimResidencySlot(
  context: LifecycleContext,
  taskId: string,
  expect: (fresh: TaskRecord) => boolean,
): ResidencyClaimResult {
  // `applied` records whether OUR claim landed inside the locked read-modify-write - a record
  // already resident+ours must read as not_claimable to a stale-observation retry, not as a win.
  let applied = false
  const claimed = context.store.mutate(taskId, (fresh) => {
    if (!expect(fresh)) return fresh
    applied = true
    return { ...fresh, residency_state: "resident", host_pid: context.hostPid, updated_at: nowIso(context) }
  })
  if (claimed === null) return "not_claimable"
  return applied ? "claimed" : "not_claimable"
}

// Reclaim an already-resident orphan (dead owner, or same-process switch with no live handle).
// The record ALREADY occupies its slot, so this never touches the capacity gate: it is the
// expected-owner CAS and nothing else. `observed` is the record the scan saw; the CAS fails if a
// sibling process claimed it first (host_pid no longer equals the observed owner).
export function reclaimOrphanedResident(context: LifecycleContext, observed: TaskRecord): ResidencyClaimResult {
  return claimResidencySlot(
    context,
    observed.task_id,
    (fresh) =>
      fresh.residency_state === "resident" &&
      fresh.host_pid === observed.host_pid &&
      fresh.updated_at === observed.updated_at,
  )
}

export async function admitSuspendedBatch(
  context: LifecycleContext,
  parentSessionId: string,
  options: BatchAdmissionOptions = {},
): Promise<BatchAdmissionResult> {
  const acquire = options.acquireLease ?? acquireSessionAdmissionLease
  const acquired = await acquire(context.store.stateDir, parentSessionId, options.timing ?? {})
  if (acquired.kind === "contended") {
    // Bounded wait expired: the WHOLE batch defers, never a throw aborting session start.
    return {
      lease: "lock_contended",
      outcomes: revivalCandidates(context, parentSessionId, options.excludeTaskIds).map((record) => ({
        task_id: record.task_id,
        kind: "deferred",
        reason: "lock_contended",
      })),
    }
  }

  const { lease } = acquired
  const outcomes: BatchAdmissionOutcome[] = []
  let leaseState: BatchAdmissionResult["lease"] = "acquired"
  try {
    const candidates = byRevivalPriority(revivalCandidates(context, parentSessionId, options.excludeTaskIds))
    // Residents include live foreign owners; when the configured cap sits below the current
    // resident count, available clamps to 0 - revive none, keep owned residents, evict nothing.
    const maxChildren = context.config.residency_max_children
    const available = maxChildren === "unlimited"
      ? candidates.length
      : Math.max(0, maxChildren - residentsFor(context, parentSessionId).length)
    const selected = candidates.slice(0, available)
    for (const record of selected) {
      // Holder-side fencing: re-read the lease before EVERY mutation; a displaced holder aborts
      // its batch rather than write under a lease it has lost.
      if (!lease.isOwner()) {
        leaseState = "lease_lost"
        outcomes.push({ task_id: record.task_id, kind: "deferred", reason: "lease_lost" })
        continue
      }
      try {
        const result = claimResidencySlot(
          context,
          record.task_id,
          (fresh) =>
            fresh.parent_session_id === parentSessionId &&
            SUSPENDED_RESIDENCIES.has(fresh.residency_state) &&
            REVIVABLE_STATUSES.has(fresh.status) &&
            fresh.killed !== true,
        )
        outcomes.push(
          result === "claimed"
            ? { task_id: record.task_id, kind: "claimed" }
            : { task_id: record.task_id, kind: "deferred", reason: "foreign_live_owner" },
        )
      } catch {
        // Each record lock is independently bounded. One contended record never aborts the batch.
        outcomes.push({ task_id: record.task_id, kind: "deferred", reason: "lock_contended" })
      }
    }
    // Overflow stays suspended with deferred/capacity - never evicted, never lost.
    for (const record of candidates.slice(available)) {
      outcomes.push({ task_id: record.task_id, kind: "deferred", reason: "capacity" })
    }
  } finally {
    lease.release()
  }
  return { lease: leaseState, outcomes }
}

function revivalCandidates(
  context: LifecycleContext,
  parentSessionId: string,
  excludeTaskIds: ReadonlySet<string> | undefined,
): readonly TaskRecord[] {
  return context.store
    .list()
    .records.filter(
      (record) =>
        !excludeTaskIds?.has(record.task_id) &&
        record.parent_session_id === parentSessionId &&
        SUSPENDED_RESIDENCIES.has(record.residency_state) &&
        REVIVABLE_STATUSES.has(record.status) &&
        record.killed !== true,
    )
}

// Non-terminal suspended records first, then terminal by updated_at DESC (MRU), tie-break
// task_id ASC. The class boundary always beats recency.
function byRevivalPriority(records: readonly TaskRecord[]): readonly TaskRecord[] {
  return [...records].toSorted((left, right) => {
    const terminality = Number(TERMINAL_STATUSES.has(left.status)) - Number(TERMINAL_STATUSES.has(right.status))
    if (terminality !== 0) return terminality
    const recency = right.updated_at.localeCompare(left.updated_at)
    return recency !== 0 ? recency : left.task_id.localeCompare(right.task_id)
  })
}
