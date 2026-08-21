import { log } from "@oh-my-opencode/utils"

import { interactionPolicyForAgent } from "../agents"
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

const TASK_OUTPUT_SUGGESTION = "Use task_output to read the final result."
const NOT_FOUND_SUGGESTION = "Use /tasks to see available tasks, or task_output to read a known task."

export function createSteeringEngine(port: SteeringPort): SteeringEngine {
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
    // The run epoch scopes this send to the run it steered: a later revive starts a fresh epoch,
    // and counting sends per epoch is what keeps a new run's messages off the prior run's tally.
    port.store.appendEvent(record.task_id, {
      type: "steered",
      payload: { delivered: deliverAs, run_epoch: record.notification.run_epoch },
    })
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
    // already dropped them with a diagnostic (todo-2 entry-drop policy).
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
        log("senpi-task steering queued delivery failed", { taskId, error: String(error) })
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
        log("senpi-task steering cancel abort rejected", { taskId: record.task_id, error: String(error) })
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

  return { sendToTask, interruptTask, cancelTask, notifyStarted, dropPending }
}

function oneShotPolicyDenial(record: TaskRecord): SendOutcome | undefined {
  const agentType = record.agent_type
  if (agentType === undefined) return undefined
  const policy = interactionPolicyForAgent(agentType)
  if (policy?.oneShot !== true) return undefined
  return { kind: "one_shot_agent", task_id: record.task_id, agent: agentType, message: policy.sendDenialReminder }
}

function scopeDenied(record: TaskRecord, input: SendInput): SendOutcome | undefined {
  if (input.callerSessionId === undefined || input.allScope === true) return undefined
  const caller = input.callerSessionId
  if (caller === record.parent_session_id || caller === record.root_session_id) return undefined
  return {
    kind: "scope_denied",
    task_id: record.task_id,
    owning_session_id: record.parent_session_id,
    reason: `Task ${record.task_id} belongs to session ${record.parent_session_id}; pass all_scope to send across sessions.`,
  }
}

function notContinuableReason(record: TaskRecord): string {
  // Suspended (session shutdown) is NOT terminal: the record is continuable, just not from this
  // process. No lazy revive-on-send - resuming the session is the wake-up path (user decision).
  if (record.residency_state === "persisted_only" || record.residency_state === "rpc_detached") {
    return `Task ${record.task_id} is suspended - resumes when its session is resumed.`
  }
  if (record.residency_state === "disposed") return `Task ${record.task_id} was disposed and can no longer be continued.`
  if (record.residency_state === "evicted") return `Task ${record.task_id} was evicted from residency and can no longer be continued.`
  return `Task ${record.task_id} is ${record.status} and can no longer be continued.`
}

function buildRevived(record: TaskRecord, timestamp: string): TaskRecord {
  // run_stats describes the FINISHED run; carrying it into the revived one would let a later
  // terminal transition report stale throughput for a run that produced nothing yet.
  const { final_response: _final, error_message: _error, run_stats: _stats, ...rest } = record
  return {
    ...rest,
    status: "running",
    residency_state: "resident",
    updated_at: timestamp,
    notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
  }
}
