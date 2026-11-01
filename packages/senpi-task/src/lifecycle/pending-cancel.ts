import type { TaskRecord } from "../state"
import { nowIso, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { endHostSessionChild } from "./host-session-end"
import { isHostSessionRecord } from "./host-session"
import type { ReconcileOutcome } from "./types"

/**
 * A task_cancel accepted while the child was unreachable outlives the process that accepted it
 * (omo#9403): its parent shut down, or its host shard crashed, before the stop landed. Whichever
 * revival reaches the record next - session-start reconcile, daemon-loss retry, a send - finishes the
 * cancel instead: the session is ended on its host, the record is cancelled, and nothing runs.
 *
 * The session is ended FIRST. A close the host refuses or does not confirm in time returns undefined
 * and leaves the cancel pending on the record, so the next revival retries it: a cancelled record whose
 * session still runs would let the child keep working until the TTL sweep caught it. A host that answers
 * but cannot list its sessions leaves the cancel pending the same way (omo#9450).
 */
export async function finishPendingCancel(context: LifecycleContext, record: TaskRecord): Promise<ReconcileOutcome | undefined> {
  if (isHostSessionRecord(record) && context.registry.get(record.task_id) === undefined) {
    // Not listed on the recorded socket is not an end: a draining generation may still run it (omo#11765).
    if ((await endHostSessionChild(context, record)).kind !== "ended") return undefined
  }
  const reason = record.cancel_requested?.reason
  const result = context.store.transition(record.task_id, {
    type: "cancel",
    timestamp: nowIso(context),
    ...(reason === undefined ? {} : { error_message: reason }),
  })
  if (result.applied) {
    context.store.appendEvent(record.task_id, {
      type: "cancelled",
      payload: { previous_status: record.status, finished_on: "revival", ...(reason === undefined ? {} : { reason }) },
    })
  }
  await destroyResidentTask(context, record.task_id, "cancel")
  return { task_id: record.task_id, kind: "resumed", reason: "pending cancel finished" }
}
