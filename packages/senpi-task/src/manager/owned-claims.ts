import type { DagTaskOwner, DagTaskOwnerScope, OwnedStartResult } from "../dag/owner"
import type { TaskRecord } from "../state"
import { isTerminalRecord } from "./manager-helpers"

export function ownedClaims(records: readonly TaskRecord[], scope: DagTaskOwnerScope): readonly TaskRecord[] {
  return records.filter(
    (record) =>
      record.owner?.kind === scope.kind &&
      (scope.runId === undefined || record.owner.runId === scope.runId) &&
      (scope.nodeId === undefined || record.owner.nodeId === scope.nodeId),
  )
}

/** The owned start's answer from the owner key's claims, oldest first; undefined starts a fresh child. */
export function ownedStartResult(
  claims: readonly TaskRecord[],
  owner: DagTaskOwner,
  // Live means "can still do work": a record that is not settled, or a refused turn not yet confirmed stopped.
  isLive: (claim: TaskRecord) => boolean = (claim) => !isTerminalRecord(claim),
): OwnedStartResult | undefined {
  // Every live claim is checked before any reuse, not only the newest: an older attempt's child can
  // be live behind a newer claim, settled or not, and must never run beside it (#11381). Which live
  // claim this is - same attempt, earlier, or newer - the DAG layer decides.
  const other = claims.findLast((claim) => isLive(claim) && claim.owner?.fingerprint !== owner.fingerprint)
  if (other !== undefined) {
    return {
      kind: "owner_conflict",
      task_id: other.task_id,
      existing_fingerprint: other.owner?.fingerprint ?? "",
      requested_fingerprint: owner.fingerprint,
    }
  }
  // A settled newest claim with another fingerprint is a retry: ownership moves to a fresh task.
  const record = claims.at(-1)
  if (record === undefined || record.owner?.fingerprint !== owner.fingerprint) return undefined
  return {
    kind: "started",
    reused: true,
    task_id: record.task_id,
    status: record.status,
    name: record.name ?? record.task_id,
    ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
  }
}
