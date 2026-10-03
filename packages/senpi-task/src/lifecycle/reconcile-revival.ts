import type { TaskRecord } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { hostSessionResumePath } from "./host-session"
import {
  deferred,
  isClaimHeld,
  isOrphan,
  reclaimResident,
  reviveClaimed,
  type SessionPathResolver,
  type SuspendedResidency,
} from "./reconcile-reclamation"
import { admitSuspendedBatch } from "./residency"
import { isRevivalCandidate, isSuspendedResidency } from "./revival-selection"
import type { ReconcileOutcome } from "./types"

export { beginLocalReclamation } from "./reconcile-reclamation"

type RevivalCandidate = {
  readonly record: TaskRecord
  readonly priorResidency: SuspendedResidency
}

export async function reconcileScopedRevival(
  context: LifecycleContext,
  parentSessionId: string,
  records: readonly TaskRecord[],
  sessionPathFor: SessionPathResolver,
): Promise<readonly ReconcileOutcome[]> {
  if (context.config.resume_children === false) return []

  const outcomes: ReconcileOutcome[] = []
  const sessionRecords = records.filter((record) => record.parent_session_id === parentSessionId)
  // A daemon-hosted child NAMES its transcript on the record. The disk scan below only knows the
  // child's own session dir, so without this a parked host session reads as "terminal with no
  // transcript" and gets disposed - throwing away a session the daemon can still reopen.
  const transcriptFor = (record: TaskRecord): string | undefined =>
    hostSessionResumePath(record) ?? sessionPathFor(record.task_id)

  // Reclamation runs first and OUTSIDE admission. These records already occupy their slot, and a
  // killed orphan can release one for the admission batch that follows.
  for (const observed of sessionRecords) {
    if (observed.residency_state !== "resident") continue
    if (!isOrphan(context, observed)) continue
    outcomes.push(await reclaimResident(context, observed, sessionPathFor))
  }

  // A terminal record without a transcript is not a revival candidate at all. Dispose it before
  // capacity selection so it neither consumes a slot nor reruns its persisted prompt. Once seen,
  // exclude it from THIS pass even if disposal lock contention is transient: admission must never
  // turn a failed no-rerun disposal into a fresh terminal prompt launch.
  const excludedFromAdmission = new Set(context.reconcileAdmission.excludeTaskIds)
  for (const observed of sessionRecords) {
    if (!isSuspended(observed) || !TERMINAL_STATUSES.has(observed.status) || observed.status === "lost") continue
    if (observed.killed === true || transcriptFor(observed) !== undefined) continue
    excludedFromAdmission.add(observed.task_id)
    const disposal = disposeSuspendedTerminalWithoutTranscript(context, observed)
    if (disposal === "disposed") {
      outcomes.push({
        task_id: observed.task_id,
        kind: "resumed",
        reason: "terminal without transcript disposed; persisted result preserved",
      })
    } else if (disposal === "lock_contended") {
      outcomes.push(deferred(observed.task_id, "lock_contended"))
    }
  }

  const candidates = suspendedCandidates(context, parentSessionId)
    .filter(({ record }) => !excludedFromAdmission.has(record.task_id))
  if (context.config.reattach_on_reconcile === false) {
    outcomes.push(...candidates.map(({ record }) => deferred(record.task_id, "reattach_disabled")))
    return outcomes
  }

  const priorResidencies = new Map(candidates.map((candidate) => [candidate.record.task_id, candidate.priorResidency]))
  const admission = await admitSuspendedBatch(context, parentSessionId, {
    ...context.reconcileAdmission,
    excludeTaskIds: excludedFromAdmission,
  })
  const reported = new Set<string>()
  for (const outcome of admission.outcomes) {
    reported.add(outcome.task_id)
    if (outcome.kind === "deferred") {
      outcomes.push(deferred(outcome.task_id, outcome.reason === "lease_lost" ? "lock_contended" : outcome.reason))
      continue
    }
    const priorResidency = priorResidencies.get(outcome.task_id)
    if (priorResidency === undefined) {
      outcomes.push(deferred(outcome.task_id, "foreign_live_owner"))
      continue
    }
    const claimed = context.store.load(outcome.task_id)
    if (!isClaimHeld(context, claimed, parentSessionId)) {
      outcomes.push(deferred(outcome.task_id, "foreign_live_owner"))
      continue
    }
    outcomes.push(await reviveClaimed(context, claimed, priorResidency, transcriptFor(claimed)))
  }
  // A concurrent sweep may claim a candidate while this sweep waits for the admission lease. The
  // fresh selector then omits it; retain one outcome per observed candidate and report the lost CAS.
  for (const candidate of candidates) {
    if (!reported.has(candidate.record.task_id)) {
      outcomes.push(deferred(candidate.record.task_id, "foreign_live_owner"))
    }
  }
  return outcomes
}

function disposeSuspendedTerminalWithoutTranscript(
  context: LifecycleContext,
  observed: TaskRecord,
): "disposed" | "not_applied" | "lock_contended" {
  let applied = false
  try {
    context.store.mutate(observed.task_id, (fresh) => {
      if (!isSuspendedResidency(fresh.residency_state) || !TERMINAL_STATUSES.has(fresh.status)) return fresh
      applied = true
      const { host_pid: _hostPid, ...rest } = fresh
      return { ...rest, residency_state: "disposed", updated_at: nowIso(context) }
    })
  } catch {
    return "lock_contended"
  }
  return applied ? "disposed" : "not_applied"
}

function suspendedCandidates(context: LifecycleContext, parentSessionId: string): readonly RevivalCandidate[] {
  return context.store.list().records.flatMap((record): readonly RevivalCandidate[] =>
    isRevivalCandidate(record, parentSessionId) && isSuspended(record) ? [{ record, priorResidency: record.residency_state }] : [])
}

function isSuspended(record: TaskRecord): record is TaskRecord & { readonly residency_state: SuspendedResidency } {
  return isSuspendedResidency(record.residency_state)
}
