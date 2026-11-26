import type { DagTaskOwner, DagTaskOwnerScope, OwnedStartResult } from "../dag/owner"
import type { TaskRecord } from "../state"
import { isTerminalRecord } from "./manager-helpers"

export function ownedClaims(records: readonly TaskRecord[], scope: DagTaskOwnerScope): readonly TaskRecord[] {
  return records.filter(
    (record) =>
      record.owner?.kind === scope.kind &&
      record.owner.runId === scope.runId &&
      (scope.nodeId === undefined || record.owner.nodeId === scope.nodeId),
  )
}

/** The owned start's answer from the owner key's claims, oldest first; undefined starts a fresh child. */
export function ownedStartResult(claims: readonly TaskRecord[], owner: DagTaskOwner): OwnedStartResult | undefined {
  const record = claims.at(-1)
  if (record === undefined) return undefined
  if (record.owner?.fingerprint !== owner.fingerprint) {
    // A settled newest claim is a retry and ownership moves to a fresh task, unless ANY claim is
    // still live: an older attempt's child can resume on its own behind a newer one (#11381).
    const live = claims.findLast((claim) => !isTerminalRecord(claim))
    if (live === undefined) return undefined
    // Which live claim this is - same attempt, earlier, or newer - the DAG layer decides (#11381).
    return {
      kind: "owner_conflict",
      task_id: live.task_id,
      existing_fingerprint: live.owner?.fingerprint ?? "",
      requested_fingerprint: owner.fingerprint,
    }
  }
  return {
    kind: "started",
    reused: true,
    task_id: record.task_id,
    status: record.status,
    name: record.name ?? record.task_id,
    ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
  }
}
