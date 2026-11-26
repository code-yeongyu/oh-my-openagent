import type { TaskRecord } from "../state"
import type { SendOutcome } from "../steering"
import type { OwnerResumeFence } from "./owner-resume"

/**
 * An explicit send asks the record's owner first (#11381): the same decision the self-resume fence and
 * the owner's child gate use. A claim the owner has retired (a superseded attempt, a removed node, a
 * cancelled or cancelling run) is refused and the child is never touched; a `hold` (a current claim of
 * a settled or user-stopped run) keeps the explicit send/revive contract, and a record no owner fences
 * is untouched. Synchronous, so a send nobody refuses keeps its start in the caller's tick.
 */
export function ownerSendRefusal(
  fence: OwnerResumeFence | undefined,
  record: TaskRecord | undefined,
): SendOutcome | undefined {
  if (fence === undefined || record?.owner === undefined) return undefined
  const verdict = fence(record)
  if (verdict.kind !== "refuse" || verdict.disposition !== "retire") return undefined
  return {
    kind: "not_continuable",
    task_id: record.task_id,
    reason: `Task ${record.task_id} cannot be sent to: ${verdict.reason}.`,
    suggestion: verdict.remedy ?? "Start a new task instead.",
  }
}
