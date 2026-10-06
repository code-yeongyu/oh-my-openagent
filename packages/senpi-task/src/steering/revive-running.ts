import type { ManagedChildHandle } from "../manager/child-handle"
import { getLifecycleDetachedRevival } from "../lifecycle/port"
import type { TaskRecord } from "../state"
import { evictionRefusal, lazyRevivalFailure } from "./engine-policy"
import { bestEffortRollback } from "./revival-rollback"
import type { SendOutcome, SteeringPort } from "./types"

const UNUSED_RESERVATION = { ok: true as const, commit: (): void => undefined, release: (): void => undefined }

/**
 * A parked daemon child that was still RUNNING is reopened, not revived into a new run: the revival's
 * own reattach opens the run's next epoch and takes its lane slot. Reserving a slot here first made
 * that reattach refuse the very slot this send held, so every send answered `lane_capacity` even on
 * an empty lane (omo#9403). The message is then delivered to the reopened session as a follow-up.
 *
 * Delivery is fenced like every other revival: the reopened run must still be this send's - running,
 * resident, uncancelled, same owner and epoch, same live handle - before the message goes out and
 * again once it is acknowledged. A message the child refused hands it back parked, never half-revived.
 */
export async function reviveRunningOnSend(
  port: SteeringPort,
  record: TaskRecord,
  message: string,
  beginSend: (taskId: string) => boolean,
  endSend: (taskId: string) => void,
): Promise<SendOutcome> {
  if (!beginSend(record.task_id)) return evictionRefusal(record.task_id)
  try {
    const reviveDetached = port.reviveDetached ?? getLifecycleDetachedRevival(port.store)
    if (reviveDetached === undefined) return lazyRevivalFailure(record, "revival is unavailable")
    let revived: Awaited<ReturnType<typeof reviveDetached>>
    try {
      revived = await reviveDetached(record.task_id, UNUSED_RESERVATION)
    } catch (error) {
      await bestEffortRollback(port, record)
      return lazyRevivalFailure(record, error instanceof Error ? error.message : String(error))
    }
    if (!revived.ok) {
      return revived.code === undefined ? lazyRevivalFailure(record, revived.reason) : { kind: revived.code, task_id: record.task_id, reason: revived.reason }
    }
    const reopened = port.store.load(record.task_id)
    const handle = port.liveHandle(record.task_id)
    if (reopened === null || handle === undefined) return lazyRevivalFailure(record, "child handle is unavailable")
    if (!stillReopened(port, reopened, reopened, handle)) return lazyRevivalFailure(record, "task ownership or status changed before delivery")
    try {
      await handle.followUp(message)
    } catch (error) {
      return await refusedDelivery(port, record, handle, error)
    }
    if (!stillReopened(port, port.store.load(record.task_id), reopened, handle)) {
      return lazyRevivalFailure(record, "revived run ended or changed ownership before delivery acknowledged")
    }
    port.store.appendEvent(record.task_id, { type: "steered", payload: { delivered: "followUp", run_epoch: reopened.notification.run_epoch } })
    return { kind: "revived", task_id: record.task_id, run_epoch: reopened.notification.run_epoch }
  } finally {
    endSend(record.task_id)
  }
}

function stillReopened(port: SteeringPort, current: TaskRecord | null, reopened: TaskRecord, handle: ManagedChildHandle): boolean {
  return current !== null &&
    current.status === "running" &&
    current.residency_state === "resident" &&
    current.killed !== true &&
    current.cancel_requested === undefined &&
    current.host_pid === reopened.host_pid &&
    current.notification.run_epoch === reopened.notification.run_epoch &&
    port.liveHandle(current.task_id) === handle
}

// A live child refused the message before taking it, so the reopen is undone and an explicit retry is
// safe. A child that exited may have taken it before the answer was lost: its outcome tracking ends
// that run, and nothing here replays or rolls it back.
async function refusedDelivery(port: SteeringPort, record: TaskRecord, handle: ManagedChildHandle, error: unknown): Promise<SendOutcome> {
  const reason = error instanceof Error ? error.message : String(error)
  if (handle.hasExited?.() === true) return lazyRevivalFailure(record, `the reopened child ended before the message was acknowledged: ${reason}`)
  await bestEffortRollback(port, record)
  port.releaseTaskLeases?.(record.task_id)
  return lazyRevivalFailure(record, `the reopened child refused the message: ${reason}`)
}
