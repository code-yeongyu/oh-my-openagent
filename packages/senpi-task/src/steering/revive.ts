import { log } from "@oh-my-opencode/utils"

import type { ManagedChildHandle } from "../manager/child-handle"
import { getLifecycleDetachedRevival, getLifecycleDetachedRevivalRollback } from "../lifecycle/port"
import type { TaskRecord } from "../state"
import { buildRevived, deliveryUncertain, lazyRevivalFailure, messageSha256, uncertainDeliveryDenial } from "./engine-policy"
import type { ReviveReservation, SendOutcome, SteeringPort } from "./types"

export async function reviveTerminal(
  port: SteeringPort,
  record: TaskRecord,
  handle: ManagedChildHandle,
  message: string,
  nowIso: () => string,
  beginSend: (taskId: string) => boolean,
  endSend: (taskId: string) => void,
): Promise<SendOutcome> {
  if (!beginSend(record.task_id)) return evictionRefusal(record.task_id)
  try {
    return await deliverRevivedTerminal(port, record, handle, message, nowIso, port.reserveForRevive(record.task_id), false)
  } finally {
    endSend(record.task_id)
  }
}

export async function reviveDetachedTerminalOnSend(
  port: SteeringPort,
  record: TaskRecord,
  message: string,
  nowIso: () => string,
  beginSend: (taskId: string) => boolean,
  endSend: (taskId: string) => void,
): Promise<SendOutcome> {
  if (!beginSend(record.task_id)) return evictionRefusal(record.task_id)
  try {
    const reservation = port.reserveForDetachedRevive?.(record) ?? port.reserveForRevive(record.task_id)
    if (!reservation.ok) {
      return { kind: "admission_refused", task_id: record.task_id, reason: "lane_capacity" }
    }
    const reviveDetached = port.reviveDetached ?? getLifecycleDetachedRevival(port.store)
    if (reviveDetached === undefined) {
      reservation.release()
      return lazyRevivalFailure(record, "revival is unavailable")
    }
    let revived: Awaited<ReturnType<typeof reviveDetached>>
    try {
      revived = await reviveDetached(record.task_id, reservation)
    } catch (error) {
      await bestEffortRollback(port, record)
      reservation.release()
      return lazyRevivalFailure(record, error instanceof Error ? error.message : String(error))
    }
    if (!revived.ok) {
      reservation.release()
      return revived.code === undefined ? lazyRevivalFailure(record, revived.reason) : { kind: revived.code, task_id: record.task_id, reason: revived.reason }
    }
    const fresh = port.store.load(record.task_id)
    const handle = port.liveHandle(record.task_id)
    if (fresh === null || handle === undefined) {
      await bestEffortRollback(port, record)
      reservation.release()
      return lazyRevivalFailure(record, "child handle is unavailable")
    }
    return deliverRevivedTerminal(port, fresh, handle, message, nowIso, reservation, true, record)
  } finally {
    endSend(record.task_id)
  }
}

async function deliverRevivedTerminal(
  port: SteeringPort,
  record: TaskRecord,
  handle: ManagedChildHandle,
  message: string,
  nowIso: () => string,
  reservation: ReviveReservation,
  rollbackOnFailure: boolean,
  priorRecord?: TaskRecord,
): Promise<SendOutcome> {
  if (!reservation.ok) {
    return { kind: "capacity_deferred", task_id: record.task_id, reason: "Task capacity is full; retry explicitly." }
  }
  let revived: TaskRecord | undefined
  let deliveryAcknowledged = false
  try {
    const fresh = port.store.load(record.task_id)
    if (fresh === null || fresh.status !== record.status || fresh.killed === true || fresh.host_pid !== record.host_pid || fresh.notification.run_epoch !== record.notification.run_epoch) {
      reservation.release()
      return lazyRevivalFailure(record, "task ownership or status changed before delivery")
    }
    // Both warm and cold continuation fence the same record. A newly observed uncertainty
    // marker wins before an epoch is admitted; continuation never uses spawn-time stamping.
    let applied = false
    let uncertain: SendOutcome | undefined
    const updated = port.store.mutate(record.task_id, (current) => {
      if (current.status !== fresh.status || current.host_pid !== fresh.host_pid || current.residency_state !== "resident" || current.killed === true || current.notification.run_epoch !== fresh.notification.run_epoch) return current
      uncertain = uncertainDeliveryDenial(current, message)
      if (uncertain !== undefined) return current
      applied = true
      return buildDeliveryRecord(current, nowIso(), message)
    })
    if (uncertain !== undefined || !applied || updated === null) {
      reservation.release()
      return uncertain ?? lazyRevivalFailure(record, "claim changed before delivery")
    }
    revived = updated
    port.store.appendEvent(record.task_id, { type: "revived", payload: { run_epoch: revived.notification.run_epoch } })
    const pending = revived.pending_steering ?? []
    await handle.followUp([...pending.map((entry) => entry.message), message].join("\n\n"))
    deliveryAcknowledged = true
    const acknowledged = port.store.load(record.task_id)
    if (acknowledged?.status !== "running" || acknowledged.host_pid !== revived.host_pid || acknowledged.notification.run_epoch !== revived.notification.run_epoch || port.liveHandle(record.task_id) !== handle) {
      reservation.release()
      return lazyRevivalFailure(record, "revived run ended or changed ownership before delivery acknowledged")
    }
    if (pending.length > 0) {
      const deliveredIds = new Set(pending.map((entry) => entry.id))
      port.store.mutate(record.task_id, (current) => {
        const { revive_delivery_uncertain: _uncertainty, ...rest } = current
        return { ...rest, pending_steering: (current.pending_steering ?? []).filter((entry) => !deliveredIds.has(entry.id)) }
      })
    }
    reservation.commit()
    return { kind: "revived", task_id: record.task_id, run_epoch: revived.notification.run_epoch }
  } catch (error) {
    if (deliveryAcknowledged && revived?.revive_delivery_uncertain !== undefined) {
      // The batch was accepted. Its pre-dispatch marker survives failed ack bookkeeping, so
      // neither rollback nor a later send can replay the still-persisted queue.
      log("senpi-task pending delivery acknowledgment persistence failed", { taskId: record.task_id, error: error instanceof Error ? error.message : String(error) })
      reservation.commit()
      return deliveryUncertain(record, revived.notification.run_epoch)
    }
    // A live child rejected the RPC before consuming the prompt, so teardown + rollback makes an
    // explicit retry safe. An exited child may have accepted it before the response was lost; keep
    // the revived epoch intact and let outcome tracking terminalize it instead of sending twice.
    const revivedForUncertainty = revived
    if (rollbackOnFailure && priorRecord !== undefined && revivedForUncertainty !== undefined && handle.hasExited?.() === true) {
      const epoch = revivedForUncertainty.notification.run_epoch
      // Fence the marker on the exact generation this revival wrote. A concurrent cancel/interrupt
      // that already won the terminal transition on this epoch owns the record; leave it untouched.
      // The marker write must be exception-safe: the reservation is committed or released exactly
      // once on every path, including a record-lock failure inside the fenced mutate.
      let marked = false
      try {
        port.store.mutate(record.task_id, (fresh) => {
          if (
            fresh.status !== "running" ||
            fresh.residency_state !== "resident" ||
            fresh.host_pid !== revivedForUncertainty.host_pid ||
            fresh.notification.run_epoch !== epoch
          ) return fresh
          marked = true
          return { ...fresh, revive_delivery_uncertain: { run_epoch: epoch, message_sha256: messageSha256(message) } }
        })
      } catch (markError) {
        reservation.release()
        return lazyRevivalFailure(
          record,
          `unacknowledged delivery could not be recorded: ${markError instanceof Error ? markError.message : String(markError)}`,
        )
      }
      if (marked) {
        reservation.commit()
        port.store.appendEvent(record.task_id, {
          type: "revive_delivery_uncertain",
          payload: { run_epoch: epoch, message_sha256: messageSha256(message) },
        })
        return deliveryUncertain(record, epoch)
      }
      reservation.release()
      return lazyRevivalFailure(record, "the revived run was terminalized before the message was acknowledged")
    }
    if (rollbackOnFailure && priorRecord !== undefined) await bestEffortRollback(port, priorRecord)
    reservation.release()
    return lazyRevivalFailure(record, error instanceof Error ? error.message : String(error))
  }
}

function buildDeliveryRecord(record: TaskRecord, timestamp: string, message: string): TaskRecord {
  const revived = buildRevived(record, timestamp)
  return record.revive_delivery_uncertain !== undefined || (record.pending_steering?.length ?? 0) === 0 ? revived : {
    ...revived,
    revive_delivery_uncertain: { run_epoch: revived.notification.run_epoch, message_sha256: messageSha256(message) },
  }
}

async function bestEffortRollback(port: SteeringPort, priorRecord: TaskRecord): Promise<void> {
  const rollback = port.rollbackDetachedRevival ?? getLifecycleDetachedRevivalRollback(port.store)
  if (rollback !== undefined) {
    try {
      if (rollback(priorRecord) === "not_owner") return
    } catch (error) {
      log("senpi-task lazy revival rollback failed", {
        taskId: priorRecord.task_id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  try {
    await port.destruction.destroyResidentTask(priorRecord.task_id, "revive_failure")
  } catch (error) {
    log("senpi-task lazy revival destruction failed", {
      taskId: priorRecord.task_id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function evictionRefusal(taskId: string): SendOutcome {
  return {
    kind: "not_continuable",
    task_id: taskId,
    reason: `Task ${taskId} is being evicted; send was not started.`,
    suggestion: "Use task_output to read the final result.",
  }
}
