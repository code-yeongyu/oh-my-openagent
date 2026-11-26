import type { TaskRecord } from "../state"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import type { DagTaskOwner } from "./owner"
import type { DagRunRecordV1 } from "./manager"

export type OwnedClaimAge = "current" | "superseded" | "newer"

/**
 * The one rule every reader of a run's owned tasks uses - the re-entry sweep, admission, and
 * recovery (#11381). An owner's explicit execAttempt decides. A legacy owner written before it
 * carried one is matched against the fingerprints of every definition the run has had; without
 * positive evidence of an attempt it counts as current, never as a stale child to stop.
 */
export function ownedClaimAge(task: TaskRecord, record: DagRunRecordV1): OwnedClaimAge {
  const owner = task.owner
  if (owner === undefined) return "current"
  const node = record.nodes.find((entry) => entry.id === owner.nodeId)
  if (node === undefined) return "current"
  const current = node.execAttempt ?? 0
  const created = owner.execAttempt ?? legacyAttempt(owner, record, current)
  if (created === undefined || created === current) return "current"
  return created < current ? "superseded" : "newer"
}

function legacyAttempt(owner: DagTaskOwner, record: DagRunRecordV1, current: number): number | undefined {
  const definitions = new Set([
    record.definitionFingerprint,
    ...(record.amendHistory ?? []).map((amend) => amend.previousFingerprint),
  ])
  for (const definitionFingerprint of definitions) {
    for (let attempt = 0; attempt <= current; attempt += 1) {
      const fingerprint = dagFingerprint(
        ownerFingerprintInput({ definitionFingerprint, nodeId: owner.nodeId, execAttempt: attempt }),
      )
      if (owner.fingerprint === fingerprint) return attempt
    }
  }
  return undefined
}
