import { randomUUID } from "node:crypto"

import type { TaskRecord } from "../state"
import { log } from "@oh-my-opencode/utils"

import { acquireSessionAdmissionLease, type AdmissionLeaseTiming } from "./admission-lease"
import { isRevivalCandidate, isUnboundedResidency, residentsOf, selectRevivalBatch } from "./revival-selection"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { AgentLimitReached } from "./errors"
import { parkHandlelessResident } from "./park-terminal-resident"
import { suspendHandle } from "./shutdown"
import type { AdmissionResult } from "./types"

/**
 * Residency cap gate (codex residency contract). A resident is a spawned-not-disposed child of the
 * parent session. Under the cap -> admit. At the cap -> LRU-evict the OLDEST terminal, idle resident
 * via the destruction port, which parks rather than destroys a queued continuation. If nothing is evictable -> reject with
 * AgentLimitReached naming the residents so the caller can explain why. An unbounded cap
 * ("unlimited" or 0) admits every child and never evicts.
 */
export async function admitResident(context: LifecycleContext, parentSessionId: string): Promise<AdmissionResult> {
  const residents = residentsFor(context, parentSessionId)
  const maxChildren = context.config.residency_max_children
  if (isUnboundedResidency(maxChildren) || residents.length < maxChildren) return { kind: "admitted" }

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
  // Capacity remains scoped to the parent session for compatibility with the persisted contract.
  // A process-wide cap needs a host registry shared by all session engines and is follow-up work.
  return residentsOf(context.store.list().records, parentSessionId)
}

/**
 * What keeps a FINISHED resident from being parked or evicted: a send being delivered right now. Its
 * durable queue does not, because parking keeps the queue on the record and a revival delivers it first
 * (#9861). Registries without the in-flight view keep the older, stricter rule.
 */
export function blocksFinishedTeardown(context: LifecycleContext, taskId: string): boolean {
  return context.registry.hasInFlightSends?.(taskId) ?? context.registry.hasPendingSends(taskId)
}

/** Reclaim terminal residents that have not been touched during the idle retention window. */
export async function reclaimIdleResidents(context: LifecycleContext): Promise<readonly string[]> {
  const cutoff = context.now() - context.config.resident_idle_timeout_ms
  const candidates = context.store.list().records.filter(
    (record) =>
      record.residency_state === "resident" &&
      (record.host_pid === context.hostPid || context.registry.get(record.task_id) !== undefined) &&
      TERMINAL_STATUSES.has(record.status) &&
      Date.parse(record.updated_at) <= cutoff &&
      !blocksFinishedTeardown(context, record.task_id),
  )
  // Each resident is reclaimed on its own (omo#9785): one child that is slow to stop never delays the
  // others, and every teardown step is bounded, so the sweep always settles and the next one runs.
  const outcomes = await Promise.all(candidates.map((candidate) => reclaimIdleResident(context, candidate, cutoff)))
  return outcomes.filter((taskId): taskId is string => taskId !== undefined)
}

async function reclaimIdleResident(context: LifecycleContext, candidate: TaskRecord, cutoff: number): Promise<string | undefined> {
  // Reuse send/teardown arbitration across suspension's asynchronous abort and dispose.
  if (context.registry.tryClaimEviction?.(candidate.task_id) === false) return undefined
  try {
    const fresh = context.store.load(candidate.task_id)
    if (
      fresh === null ||
      fresh.residency_state !== "resident" ||
      (fresh.host_pid !== context.hostPid && context.registry.get(fresh.task_id) === undefined) ||
      !TERMINAL_STATUSES.has(fresh.status) ||
      Date.parse(fresh.updated_at) > cutoff ||
      blocksFinishedTeardown(context, fresh.task_id)
    ) return undefined
    if (fresh.killed === true || fresh.status === "cancelled" || fresh.status === "lost") {
      await destroyResidentTask(context, fresh.task_id, "cancel")
    } else {
      const handle = context.registry.get(fresh.task_id)
      // Without a handle only the record is parked, and only when nothing can still be running for it;
      // anything else (a daemon session, a live pid) stays for reconciliation.
      if (handle === undefined) return parkHandlelessResident(context, fresh, "idle") ? fresh.task_id : undefined
      await suspendHandle(context, handle, "idle")
    }
    return fresh.task_id
  } catch (error) {
    log("senpi-task idle resident suspension failed", {
      taskId: candidate.task_id,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  } finally {
    context.registry.releaseEviction?.(candidate.task_id)
  }
}

export function startIdleResidentReclaimer(
  context: LifecycleContext,
  cleanupExpired: () => Promise<unknown> = async () => undefined,
): () => void {
  let running = false
  const timer = context.idleReclaimerScheduler.setInterval(() => {
    if (running) return
    running = true
    void reclaimIdleResidents(context)
      .then(() => cleanupExpired())
      .catch((error) => {
        log("senpi-task idle resident sweep failed", { error: String(error) })
      })
      .finally(() => { running = false })
  }, context.config.resident_idle_timeout_ms)
  timer.unref?.()
  return () => context.idleReclaimerScheduler.clearInterval(timer)
}

// Oldest-first scan (updated_at is touched on every steer/revive, so it tracks recency of use). The
// first terminal resident with no in-flight send is the LRU victim; a durable queue forces parking. EVERY terminal status (including
// lost and cancelled) is reclaimable: a lost child is unreachable and must never pin a slot.
function lruEvictable(context: LifecycleContext, residents: readonly TaskRecord[]): TaskRecord | undefined {
  return [...residents]
    .filter((record) => TERMINAL_STATUSES.has(record.status) && !blocksFinishedTeardown(context, record.task_id))
    .toSorted((left, right) => left.updated_at.localeCompare(right.updated_at))[0]
}

// --- Reconciliation batch admission (session-resume revival) -----------------------------
// Governs ONLY records needing a NEW residency slot (persisted_only / rpc_detached). Already-
// resident orphan reclamation bypasses this path entirely and is never capacity-gated. The whole
// batch runs under the per-parent-session admission lease (admission-lease.ts); the critical
// section contains ONLY record reads and store.mutate claims - no respawn I/O, no filesystem
// deletion, no process spawning - so it stays short by construction.

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
    return { ...fresh, residency_state: "resident", host_pid: context.hostPid, updated_at: nowIso(context), residency_claim: randomUUID() }
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
      outcomes: context.store.list().records
        .filter((record) => !options.excludeTaskIds?.has(record.task_id) && isRevivalCandidate(record, parentSessionId))
        .map((record) => ({
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
    // Residents include live foreign owners; when the configured cap sits below the current
    // resident count, nothing is selected - revive none, keep owned residents, evict nothing.
    const { selected, deferred } = selectRevivalBatch(
      context.store.list().records,
      parentSessionId,
      context.config.residency_max_children,
      options.excludeTaskIds,
    )
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
          (fresh) => isRevivalCandidate(fresh, parentSessionId),
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
    for (const record of deferred) {
      outcomes.push({ task_id: record.task_id, kind: "deferred", reason: "capacity" })
    }
  } finally {
    lease.release()
  }
  return { lease: leaseState, outcomes }
}
