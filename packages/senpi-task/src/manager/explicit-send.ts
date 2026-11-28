import type { TaskRecord } from "../state"
import type { SendInput, SendOutcome, SteeringEngine } from "../steering"
import type { OwnerResumeFence } from "./owner-resume"
import { sendBehindRefusedStop, type RefusedStops } from "./refused-stops"

/**
 * The manager's checks before an explicit send (#11381), in the one order that discloses nothing: the
 * address is resolved once, in the caller's scope (steering's resolver), so a task outside it resolves to
 * nothing and the send goes on to steering's missing-id answer without any record, owner or refused stop
 * being asked; then the owner's decision; then the wait behind a refused turn's stop. `answer` is
 * undefined, synchronously, when nothing applies, so such a send starts in the caller's tick; every later
 * step uses `taskId`.
 */
export function explicitSendChecks(
  steering: Pick<SteeringEngine, "resolveSendTarget">,
  fence: OwnerResumeFence | undefined,
  stops: RefusedStops,
  input: SendInput,
): { readonly taskId: string; readonly answer?: SendOutcome | Promise<SendOutcome | undefined> } {
  const record = steering.resolveSendTarget(input.idOrName, input)
  if (record === undefined) return { taskId: input.idOrName }
  const denied = ownerSendRefusal(fence, record)
  if (denied !== undefined) return { taskId: record.task_id, answer: denied }
  const waiting = sendBehindRefusedStop(stops, record.task_id)
  return waiting === undefined ? { taskId: record.task_id } : { taskId: record.task_id, answer: waiting }
}

/**
 * An explicit send asks the record's owner (the same decision the self-resume fence and the owner's
 * child gate use): a claim the owner retired (a superseded attempt, a removed node, a cancelled or
 * cancelling run) is refused and the child is never touched; a `hold` keeps the explicit send/revive
 * contract, and a record no owner fences is untouched.
 */
function ownerSendRefusal(fence: OwnerResumeFence | undefined, record: TaskRecord): SendOutcome | undefined {
  if (fence === undefined || record.owner === undefined) return undefined
  const verdict = fence(record)
  if (verdict.kind !== "refuse" || verdict.disposition !== "retire") return undefined
  return {
    kind: "not_continuable",
    task_id: record.task_id,
    reason: `Task ${record.task_id} cannot be sent to: ${verdict.reason}.`,
    suggestion: verdict.remedy ?? "Start a new task instead.",
  }
}
