import { log } from "@oh-my-opencode/utils"

import type { ManagedChildHandle } from "../manager/child-handle"
import { messageability } from "../state"
import type { TaskRecord } from "../state"
import {
  DEFAULT_SEND_DELIVERY,
  type CancelOutcome,
  type CancelInput,
  type InterruptOutcome,
  type InterruptInput,
  type SendDelivery,
  type SendInput,
  type SendOutcome,
  type SteeringEngine,
  type SteeringPort,
  type UnmanagedLiveProcessOutcome,
} from "./types"
import { decideContinuationOwnership } from "./ownership"

const TASK_OUTPUT_SUGGESTION = "Use task_output to read the final result."
const NOT_FOUND_SUGGESTION = "Use /tasks to see available tasks, or task_output to read a known task."

type QueuedMessage = { readonly message: string; readonly deliverAs: SendDelivery }

export function createSteeringEngine(port: SteeringPort): SteeringEngine {
  // Messages sent to a still-pending (queued) child buffer here and drain, in order, on start.
  const pending = new Map<string, QueuedMessage[]>()

  function resolve(idOrName: string): TaskRecord | undefined {
    const byId = tryLoad(idOrName)
    if (byId !== undefined) return byId
    return port.store.list().records.find((record) => record.name === idOrName)
  }

  function tryLoad(taskId: string): TaskRecord | undefined {
    try {
      return port.store.load(taskId) ?? undefined
    } catch {
      return undefined
    }
  }

  function nowIso(): string {
    return new Date(port.now()).toISOString()
  }

  async function sendToTask(input: SendInput): Promise<SendOutcome> {
    const record = resolve(input.idOrName)
    if (record === undefined) {
      return { kind: "not_found", reason: `No task found for "${input.idOrName}".`, suggestion: NOT_FOUND_SUGGESTION }
    }
    const denied = scopeDenied(record, input)
    if (denied !== undefined) return denied

    const deliverAs = input.deliverAs ?? DEFAULT_SEND_DELIVERY
    if (record.status === "pending") return enqueuePending(record.task_id, input.message, deliverAs)

    const mode = messageability(record.status, record.residency_state)
    if (mode === "not-continuable") {
      return { kind: "not_continuable", task_id: record.task_id, reason: notContinuableReason(record), suggestion: TASK_OUTPUT_SUGGESTION }
    }
    const handle = port.liveHandle(record.task_id)
    if (handle === undefined) {
      return {
        kind: "not_continuable",
        task_id: record.task_id,
        reason: `Task ${record.task_id} has no resident session in this process.`,
        suggestion: TASK_OUTPUT_SUGGESTION,
      }
    }

    if (mode === "steer") return steerRunning(record, handle, input.message, deliverAs)
    return reviveTerminal(record, handle, input.message)
  }

  async function steerRunning(record: TaskRecord, handle: ManagedChildHandle, message: string, deliverAs: SendDelivery): Promise<SendOutcome> {
    if (deliverAs === "steer") await handle.steer(message)
    else await handle.followUp(message)
    port.store.appendEvent(record.task_id, { type: "steered", payload: { delivered: deliverAs } })
    return { kind: "steered", task_id: record.task_id, status: record.status, delivered: deliverAs }
  }

  async function reviveTerminal(record: TaskRecord, handle: ManagedChildHandle, message: string): Promise<SendOutcome> {
    // Revive is a follow-up prompt on the SAME session (codex followup_task), not a fresh child.
    await handle.followUp(message)
    const revived = buildRevived(record, nowIso())
    port.store.replace(revived)
    port.store.appendEvent(record.task_id, { type: "revived", payload: { run_epoch: revived.notification.run_epoch } })
    port.reacquireForRevive(record.task_id)
    return { kind: "revived", task_id: record.task_id, run_epoch: revived.notification.run_epoch }
  }

  function enqueuePending(taskId: string, message: string, deliverAs: SendDelivery): SendOutcome {
    const queue = pending.get(taskId) ?? []
    queue.push({ message, deliverAs })
    pending.set(taskId, queue)
    port.store.appendEvent(taskId, { type: "steer_queued", payload: { queue_position: queue.length, deliverAs } })
    return { kind: "queued", task_id: taskId, queue_position: queue.length }
  }

  function dropPending(taskId: string): void {
    pending.delete(taskId)
  }

  async function notifyStarted(taskId: string): Promise<void> {
    const queue = pending.get(taskId)
    if (queue === undefined || queue.length === 0) return
    const handle = port.liveHandle(taskId)
    if (handle === undefined) return
    pending.delete(taskId)
    for (const item of queue) {
      try {
        if (item.deliverAs === "steer") await handle.steer(item.message)
        else await handle.followUp(item.message)
        port.store.appendEvent(taskId, { type: "steered", payload: { delivered: item.deliverAs, queued: true } })
      } catch (error) {
        log("senpi-task steering queued delivery failed", { taskId, error: String(error) })
      }
    }
  }

  async function interruptTask(input: InterruptInput): Promise<InterruptOutcome> {
    const record = resolve(input.idOrName)
    if (record === undefined) return { kind: "not_found", reason: `No task found for "${input.idOrName}".` }
    const denied = scopeDenied(record, input)
    if (denied !== undefined) return denied
    if (record.status !== "running") {
      return { kind: "noop", task_id: record.task_id, status: record.status, reason: `Task ${record.task_id} is ${record.status}, not running.` }
    }
    const handle = port.liveHandle(record.task_id)
    const unmanaged = unmanagedLiveProcess(record, handle)
    if (unmanaged !== undefined) return unmanaged
    // Transition BEFORE abort so steering is the single terminal writer: abort settles the launch
    // outcome tracker, whose late complete/cancel transition is then rejected by terminal idempotence.
    const result = port.store.transition(record.task_id, { type: "interrupt", timestamp: nowIso() })
    if (!result.applied) {
      return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be interrupted from running.` }
    }
    if (handle !== undefined) await handle.abort()
    const partial = handle?.lastAssistantText()
    if (partial !== undefined && partial.length > 0) {
      port.store.replace({ ...result.record, final_response: partial })
    }
    port.store.appendEvent(record.task_id, { type: "interrupted", payload: { previous_status: "running" } })
    return { kind: "interrupted", task_id: record.task_id, previous_status: "running" }
  }

  async function cancelTask(input: CancelInput): Promise<CancelOutcome> {
    const record = resolve(input.idOrName)
    if (record === undefined) return { kind: "not_found", reason: `No task found for "${input.idOrName}".` }
    const denied = scopeDenied(record, input)
    if (denied !== undefined) return denied
    const reason = input.reason
    if (record.status === "pending") {
      const result = port.store.transition(record.task_id, {
        type: "cancel",
        timestamp: nowIso(),
        ...(reason !== undefined ? { error_message: reason } : {}),
      })
      if (!result.applied) {
        return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be cancelled from pending.` }
      }
      port.dequeuePending(record.task_id)
      pending.delete(record.task_id)
      port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: "pending", ...(reason !== undefined ? { reason } : {}) } })
      await port.destruction.destroyResidentTask(record.task_id, "cancel")
      return { kind: "cancelled", task_id: record.task_id, previous_status: "pending" }
    }
    if (record.status !== "running") {
      const reasonText = record.status === "cancelled" ? `Task ${record.task_id} is already cancelled.` : `Task ${record.task_id} is ${record.status}, not running.`
      return { kind: "noop", task_id: record.task_id, status: record.status, reason: reasonText }
    }
    const handle = port.liveHandle(record.task_id)
    const unmanaged = unmanagedLiveProcess(record, handle)
    if (unmanaged !== undefined) return unmanaged
    // Transition BEFORE abort so this cancel is the single terminal write; the tracker's later
    // complete/cancel transition (settled by abort) is rejected by terminal idempotence.
    const result = port.store.transition(record.task_id, {
      type: "cancel",
      timestamp: nowIso(),
      ...(reason !== undefined ? { error_message: reason } : {}),
    })
    if (!result.applied) {
      return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be cancelled from running.` }
    }
    // The record is already terminal (cancelled) above. abort() is best-effort: an rpc child that
    // already exited rejects the abort send (protocol-client isExited), and a rejection here must NOT
    // skip the destruction that moves the record OUT of resident - otherwise it freezes at
    // {cancelled, resident}, un-evictable, leaking a residency slot forever.
    if (handle !== undefined) {
      try {
        await handle.abort()
      } catch (error) {
        log("senpi-task steering cancel abort rejected", { taskId: record.task_id, error: String(error) })
      }
    }
    port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: "running", ...(reason !== undefined ? { reason } : {}) } })
    // Destruction is delegated EXCLUSIVELY to lifecycle's port; steering never disposes directly.
    await port.destruction.destroyResidentTask(record.task_id, "cancel")
    return { kind: "cancelled", task_id: record.task_id, previous_status: "running" }
  }

  return { sendToTask, interruptTask, cancelTask, notifyStarted, dropPending }
}

function unmanagedLiveProcess(
  record: TaskRecord,
  handle: ManagedChildHandle | undefined,
): UnmanagedLiveProcessOutcome | undefined {
  if (handle !== undefined || record.execution_mode !== "process" || record.residency_state !== "resident" || record.pid === undefined) {
    return undefined
  }
  return {
    kind: "unmanaged_live_process",
    task_id: record.task_id,
    pid: record.pid,
    reason: `Task ${record.task_id} has no local handle for process pid ${record.pid}.`,
  }
}

function scopeDenied(
  record: TaskRecord,
  input: Pick<SendInput, "callerSessionId">,
): Extract<SendOutcome, { readonly kind: "scope_denied" }> | undefined {
  const decision = decideContinuationOwnership(record, input.callerSessionId)
  if (decision.allowed) return undefined
  return {
    kind: "scope_denied",
    task_id: record.task_id,
    owning_session_id: record.parent_session_id,
    ownership_reason: decision.reason,
    reason: `Task ${record.task_id} can only be continued by direct owner session ${record.parent_session_id}.`,
  }
}

function notContinuableReason(record: TaskRecord): string {
  if (record.residency_state === "disposed") return `Task ${record.task_id} was disposed and can no longer be continued.`
  if (record.residency_state === "evicted") return `Task ${record.task_id} was evicted from residency and can no longer be continued.`
  return `Task ${record.task_id} is ${record.status} and can no longer be continued.`
}

function buildRevived(record: TaskRecord, timestamp: string): TaskRecord {
  const { final_response: _final, error_message: _error, ...rest } = record
  return {
    ...rest,
    status: "running",
    residency_state: "resident",
    updated_at: timestamp,
    notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
  }
}
