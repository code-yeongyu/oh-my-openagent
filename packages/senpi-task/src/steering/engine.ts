import { log } from "@oh-my-opencode/utils"

import type { ManagedChildHandle } from "../manager/child-handle"
import { messageability } from "../state"
import type { PendingSteeringEntry, TaskRecord } from "../state"
import {
  DEFAULT_SEND_DELIVERY,
  type CancelOptions,
  type CancelOutcome,
  type InterruptOutcome,
  type SendDelivery,
  type SendInput,
  type SendOutcome,
  type SteeringEngine,
  type SteeringPort,
} from "./types"
import {
  deliveryUncertain,
  messageSha256,
  notContinuableReason,
  oneShotPolicyDenial,
  scopeDenied,
} from "./engine-policy"
import { reviveDetachedTerminalOnSend, reviveTerminal } from "./revive"

const TASK_OUTPUT_SUGGESTION = "Use task_output to read the final result."
const NOT_FOUND_SUGGESTION = "Use /tasks to see available tasks, or task_output to read a known task."

export function createSteeringEngine(port: SteeringPort): SteeringEngine {
  const pendingSends = new Map<string, number>()

  // Prelaunch steering is DURABLE: messages sent to a still-pending (queued) child append to the
  // record's pending_steering via store.mutate, so the queue survives a process restart (and a
  // session shutdown that suspends the pending child) and drains, in persisted order, when the
  // child eventually launches. The record is the single source of truth - no in-memory shadow.

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
    // One-shot policy runs after ownership is established but BEFORE the pending enqueue and
    // messageability: a one-shot agent refuses task_send in every state (running, pending,
    // terminal, cross-session alike), and an unauthorized caller learns only the scope denial.
    const oneShot = oneShotPolicyDenial(record)
    if (oneShot !== undefined) return oneShot

    const deliverAs = input.deliverAs ?? DEFAULT_SEND_DELIVERY
    if (record.status === "pending") return enqueuePending(record, input.message, deliverAs)
    if (port.isEvicting?.(record.task_id) === true) return evictionRefusal(record.task_id)

    const mode = messageability(record.status, record.residency_state, record.execution_mode, record.killed)
    if (mode === "not-continuable") {
      return { kind: "not_continuable", task_id: record.task_id, reason: notContinuableReason(record), suggestion: TASK_OUTPUT_SUGGESTION }
    }
    const uncertain = record.revive_delivery_uncertain
    if (
      record.status === "running" &&
      uncertain?.run_epoch === record.notification.run_epoch &&
      uncertain.message_sha256 === messageSha256(input.message)
    ) {
      return deliveryUncertain(record, record.notification.run_epoch)
    }
    const handle = port.liveHandle(record.task_id)
    if (handle === undefined) {
      if (record.residency_state === "rpc_detached" && record.execution_mode === "process") {
        return reviveDetachedTerminalOnSend(port, record, input.message, nowIso, beginSend, endSend)
      }
      return {
        kind: "not_continuable",
        task_id: record.task_id,
        reason: `Task ${record.task_id} has no resident session in this process.`,
        suggestion: TASK_OUTPUT_SUGGESTION,
      }
    }
    if (handle.hasExited?.() === true) {
      return {
        kind: "not_continuable",
        task_id: record.task_id,
        reason: `Task ${record.task_id} exited before its last message was acknowledged.`,
        suggestion: "Inspect task_output before resending.",
      }
    }

    if (mode === "steer") return steerRunning(record, handle, input.message, deliverAs)
    return reviveTerminal(port, record, handle, input.message, nowIso, beginSend, endSend)
  }

  async function steerRunning(record: TaskRecord, handle: ManagedChildHandle, message: string, deliverAs: SendDelivery): Promise<SendOutcome> {
    if (!beginSend(record.task_id)) return evictionRefusal(record.task_id)
    try {
      if (deliverAs === "steer") await handle.steer(message)
      else await handle.followUp(message)
    } finally {
      endSend(record.task_id)
    }
    // The run epoch scopes this send to the run it steered: a later revive starts a fresh epoch,
    // and counting sends per epoch is what keeps a new run's messages off the prior run's tally.
    port.store.appendEvent(record.task_id, {
      type: "steered",
      payload: { delivered: deliverAs, run_epoch: record.notification.run_epoch },
    })
    return { kind: "steered", task_id: record.task_id, status: record.status, delivered: deliverAs }
  }

  function enqueuePending(record: TaskRecord, message: string, deliverAs: SendDelivery): SendOutcome {
    let position = 0
    const updated = port.store.mutate(record.task_id, (fresh) => {
      const entry: PendingSteeringEntry = {
        id: `ps-${port.now()}-${(fresh.pending_steering ?? []).length + 1}`,
        message,
        deliver_as: deliverAs,
      }
      const queue = [...(fresh.pending_steering ?? []), entry]
      position = queue.length
      return { ...fresh, pending_steering: queue }
    })
    if (updated === null) {
      return { kind: "not_found", reason: `No task found for "${record.task_id}".`, suggestion: NOT_FOUND_SUGGESTION }
    }
    port.store.appendEvent(record.task_id, {
      type: "steer_queued",
      payload: { queue_position: position, deliverAs, run_epoch: updated.notification.run_epoch },
    })
    return { kind: "queued", task_id: record.task_id, queue_position: position }
  }

  function beginSend(taskId: string): boolean {
    if (port.tryBeginSend?.(taskId) === false) return false
    pendingSends.set(taskId, (pendingSends.get(taskId) ?? 0) + 1)
    return true
  }

  function endSend(taskId: string): void {
    const count = pendingSends.get(taskId) ?? 0
    if (count <= 1) pendingSends.delete(taskId)
    else pendingSends.set(taskId, count - 1)
    port.endSend?.(taskId)
  }

  function hasPendingSends(taskId: string): boolean {
    return (pendingSends.get(taskId) ?? 0) > 0 || (tryLoad(taskId)?.pending_steering?.length ?? 0) > 0
  }

  function evictionRefusal(taskId: string): SendOutcome {
    return {
      kind: "not_continuable",
      task_id: taskId,
      reason: `Task ${taskId} is being evicted; send was not started.`,
      suggestion: TASK_OUTPUT_SUGGESTION,
    }
  }

  function dropPending(taskId: string): void {
    clearPersistedQueue(taskId)
  }

  // Removes persisted queue entries. With drainedIds, only the entries that were just delivered
  // are cleared, so a concurrent enqueue that landed after the drain read survives; without it
  // the whole queue goes (cancel / manager-forget paths, where the child will never start).
  function clearPersistedQueue(taskId: string, drainedIds?: ReadonlySet<string>): void {
    port.store.mutate(taskId, (fresh) => {
      const queue = fresh.pending_steering
      if (queue === undefined || queue.length === 0) return fresh
      const remaining = drainedIds === undefined ? [] : queue.filter((entry) => !drainedIds.has(entry.id))
      if (remaining.length === queue.length) return fresh
      if (remaining.length === 0) {
        const { pending_steering: _cleared, ...rest } = fresh
        return rest
      }
      return { ...fresh, pending_steering: remaining }
    })
  }

  async function notifyStarted(taskId: string): Promise<void> {
    // Drain from the FRESH record (not a cached copy): a restarted engine must see exactly what
    // was persisted, in persisted order. Malformed entries never reach here - the store parser
    // already dropped them with a diagnostic.
    const fresh = tryLoad(taskId)
    const queue = fresh?.pending_steering
    if (fresh === undefined || queue === undefined || queue.length === 0) return
    const handle = port.liveHandle(taskId)
    if (handle === undefined) return
    for (const entry of queue) {
      try {
        if (entry.deliver_as === "steer") await handle.steer(entry.message)
        else await handle.followUp(entry.message)
        port.store.appendEvent(taskId, {
          type: "steered",
          payload: { delivered: entry.deliver_as, queued: true, run_epoch: fresh.notification.run_epoch },
        })
      } catch (error) {
        log("senpi-task steering queued delivery failed", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    clearPersistedQueue(taskId, new Set(queue.map((entry) => entry.id)))
  }

  async function interruptTask(idOrName: string): Promise<InterruptOutcome> {
    const record = resolve(idOrName)
    if (record === undefined) return { kind: "not_found", reason: `No task found for "${idOrName}".` }
    if (record.status !== "running") {
      return { kind: "noop", task_id: record.task_id, status: record.status, reason: `Task ${record.task_id} is ${record.status}, not running.` }
    }
    // Transition BEFORE abort so steering is the single terminal writer: abort settles the launch
    // outcome tracker, whose late complete/cancel transition is then rejected by terminal idempotence.
    const result = port.store.transition(record.task_id, { type: "interrupt", timestamp: nowIso() })
    if (!result.applied) {
      return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be interrupted from running.` }
    }
    const handle = port.liveHandle(record.task_id)
    if (handle !== undefined) await handle.abort()
    const partial = handle?.lastAssistantText()
    if (partial !== undefined && partial.length > 0) {
      port.store.replace({ ...result.record, final_response: partial })
    }
    port.store.appendEvent(record.task_id, { type: "interrupted", payload: { previous_status: "running" } })
    return { kind: "interrupted", task_id: record.task_id, previous_status: "running" }
  }

  async function cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome> {
    const record = resolve(idOrName)
    const destructionCause = options?.abort === "skip" ? "cancel_without_abort" : "cancel"
    if (record === undefined) return { kind: "not_found", reason: `No task found for "${idOrName}".` }
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
      clearPersistedQueue(record.task_id)
      port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: "pending", ...(reason !== undefined ? { reason } : {}) } })
      await port.destruction.destroyResidentTask(record.task_id, destructionCause)
      return { kind: "cancelled", task_id: record.task_id, previous_status: "pending" }
    }
    if (record.status !== "running") {
      const reasonText = record.status === "cancelled" ? `Task ${record.task_id} is already cancelled.` : `Task ${record.task_id} is ${record.status}, not running.`
      return { kind: "noop", task_id: record.task_id, status: record.status, reason: reasonText }
    }
    // Transition BEFORE abort so this cancel is the single terminal write; the tracker's later
    // complete/cancel transition (settled by abort) is rejected by terminal idempotence.
    const runStats = port.runStatsSnapshot(record.task_id)
    const result = port.store.transition(record.task_id, {
      type: "cancel",
      timestamp: nowIso(),
      ...(reason !== undefined ? { error_message: reason } : {}),
      ...(runStats !== undefined ? { run_stats: runStats } : {}),
    })
    if (!result.applied) {
      return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be cancelled from running.` }
    }
    const handle = port.liveHandle(record.task_id)
    // The record is already terminal (cancelled) above. abort() is best-effort: an rpc child that
    // already exited rejects the abort send (protocol-client isExited), and a rejection here must NOT
    // skip the destruction that moves the record OUT of resident - otherwise it freezes at
    // {cancelled, resident}, un-evictable, leaking a residency slot forever.
    if (handle !== undefined && options?.abort !== "skip") {
      try {
        await handle.abort()
      } catch (error) {
        log("senpi-task steering cancel abort rejected", {
          taskId: record.task_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: "running", ...(reason !== undefined ? { reason } : {}) } })
    // An active Senpi in-process session can float AbortError from both abort() and dispose(). DAG
    // cancellation therefore records terminal state now and lets that child reach its exact outcome
    // boundary before lifecycle disposes it. RPC children still terminate immediately.
    if (options?.abort === "skip" && handle !== undefined && handle.terminate === undefined) {
      destroyAfterSettlement(handle, record.task_id)
    } else {
      // Destruction is delegated EXCLUSIVELY to lifecycle's port; steering never disposes directly.
      await port.destruction.destroyResidentTask(record.task_id, destructionCause)
    }
    return { kind: "cancelled", task_id: record.task_id, previous_status: "running" }
  }

  function destroyAfterSettlement(handle: ManagedChildHandle, taskId: string): void {
    const destroy = (): Promise<void> => port.destruction.destroyResidentTask(taskId, "cancel_without_abort")
    void handle.waitForOutcome().then(destroy, destroy).catch((error: unknown) => {
      log("senpi-task deferred cancel destruction rejected", { taskId, error: String(error) })
    })
  }

  return { sendToTask, interruptTask, cancelTask, notifyStarted, hasPendingSends, dropPending }
}
