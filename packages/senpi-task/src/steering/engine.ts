import type { ManagedChildHandle } from "../manager/child-handle"
import { isTransportLostMessage, messageability } from "../state"
import { isColdRevivalCandidate } from "../lifecycle/revive-policy"
import type { TaskRecord } from "../state"
import { runMoved, staleSend } from "./stale-run"
import {
  DEFAULT_SEND_DELIVERY,
  type SendDelivery,
  type SendInput,
  type SendOutcome,
  type ReviveReservation,
  type SteeringEngine,
  type SteeringPort,
} from "./types"
import {
  evictionRefusal,
  uncertainDeliveryDenial,
  notContinuableReason,
  oneShotPolicyDenial,
  scopeDenied,
} from "./engine-policy"
import { reviveDetachedTerminalOnSend, reviveTerminal } from "./revive"
import { reviveRunningOnSend } from "./revive-running"
import { createSteeringControls } from "./controls"
import { createPendingSteering } from "./pending-steering"
import { HostSessionDetachedError, SessionHeldElsewhereError } from "../runners/rpc-host/session-wire"

const TASK_OUTPUT_SUGGESTION = "Use task_output to read the final result."
const NOT_FOUND_SUGGESTION = "Use /tasks to see available tasks, or task_output to read a known task."

export function createSteeringEngine(port: SteeringPort): SteeringEngine {
  const pendingSends = new Map<string, number>()
  const coldRevivals = new Set<string>()
  const { enqueuePending, clearPersistedQueue, notifyStarted, isDraining } = createPendingSteering(port, tryLoad)

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

  async function sendToTask(input: SendInput, reservation?: ReviveReservation): Promise<SendOutcome> {
    const record = resolve(input.idOrName)
    if (record === undefined) {
      return { kind: "not_found", reason: `No task found for "${input.idOrName}".`, suggestion: NOT_FOUND_SUGGESTION }
    }
    const denied = scopeDenied(record, input)
    if (denied !== undefined) return denied
    // A fenced send acts on exactly this record's run: every revive below re-checks that run_epoch
    // inside its own record mutation, so a run that moves after this check is never revived twice.
    if (runMoved(record, input.expectedRunEpoch)) return staleSend(record)
    // One-shot policy runs after ownership is established but BEFORE the pending enqueue and
    // messageability: a one-shot agent refuses task_send in every state (running, pending,
    // terminal, cross-session alike), and an unauthorized caller learns only the scope denial.
    const oneShot = oneShotPolicyDenial(record)
    if (oneShot !== undefined) return oneShot
    if (record.failure_kind === "suspended_unresumable" && record.status === "error") {
      return { kind: "not_continuable", task_id: record.task_id,
        reason: [record.error_message, record.final_response].filter(Boolean).join("\n\n"), suggestion: TASK_OUTPUT_SUGGESTION }
    }

    const deliverAs = input.deliverAs ?? DEFAULT_SEND_DELIVERY
    if (record.status === "pending") return enqueuePending(record, input.message, deliverAs)
    if (port.isEvicting?.(record.task_id) === true) return evictionRefusal(record.task_id)
    // An accepted cancel is final: nothing may revive or steer the child it is stopping (omo#9403).
    if (record.status === "running" && record.cancel_requested !== undefined) {
      return {
        kind: "not_continuable",
        task_id: record.task_id,
        reason: `Task ${record.task_id} has a pending cancel and will not run again.`,
        suggestion: TASK_OUTPUT_SUGGESTION,
      }
    }
    if (record.status === "running" && record.killed !== true
      && (record.residency_state !== "resident" || record.suspension_reason !== undefined)) {
      if (record.runner_kind === "host-session" && record.host_session !== undefined && record.residency_state === "rpc_detached") {
        return reviveRunningOnSend(port, record, input.message, beginSend, endSend,
          () => enqueuePending(record, input.message, deliverAs))
      }
      return enqueuePending(record, input.message, deliverAs)
    }

    if (coldRevivals.has(record.task_id)) return { kind: "admission_refused", task_id: record.task_id, reason: "revival_in_progress" }
    const cold = isColdRevivalCandidate(record)
    // Daemon-hosted children are read with their host identity: a PARKED session whose daemon still
    // answers is reachable (reopened from its transcript, then delivered to), never `not_continuable`.
    const mode = messageability(
      record.status,
      record.residency_state,
      record.execution_mode,
      record.killed,
      record.runner_kind,
      record.host_session,
      port.isDaemonReachable,
    )
    if (!cold && mode === "not-continuable") {
      return { kind: "not_continuable", task_id: record.task_id, reason: notContinuableReason(record), suggestion: TASK_OUTPUT_SUGGESTION }
    }
    const uncertain = uncertainDeliveryDenial(record, input.message)
    if (uncertain !== undefined) return uncertain
    if (cold) {
      coldRevivals.add(record.task_id)
      try { return await reviveDetachedTerminalOnSend(port, record, input.message, nowIso, beginSend, endSend, reservation) }
      finally { coldRevivals.delete(record.task_id) }
    }
    const handle = port.liveHandle(record.task_id)
    if (handle === undefined) {
      if (record.residency_state === "rpc_detached" && record.execution_mode === "process") {
        return reviveDetachedTerminalOnSend(port, record, input.message, nowIso, beginSend, endSend, reservation)
      }
      return {
        kind: "not_continuable",
        task_id: record.task_id,
        reason: `Task ${record.task_id} has no resident session in this process.`,
        suggestion: TASK_OUTPUT_SUGGESTION,
      }
    }
    if (handle.hasExited?.() === true) {
      // A child whose connection never came back ended for that reason; say so instead of pointing at
      // a message (omo#9403). Its transcript and worktree are left for the parent to recover from.
      const lost = isTransportLostMessage(record.error_message)
      return {
        kind: "not_continuable",
        task_id: record.task_id,
        reason: lost
          ? `Task ${record.task_id} ended: ${record.error_message}. Its transcript and worktree are kept.`
          : `Task ${record.task_id} exited before its last message was acknowledged.`,
        suggestion: lost ? "Read its work with task_output and start a new task to continue it." : "Inspect task_output before resending.",
      }
    }

    // While anything is queued or draining for this child, a new message goes behind it, so a later
    // send never overtakes an earlier one (#9861).
    if (mode === "steer" && ((record.pending_steering?.length ?? 0) > 0 || isDraining(record.task_id))) {
      return enqueuePending(record, input.message, deliverAs)
    }
    if (mode === "steer") return steerRunning(record, handle, input.message, deliverAs)
    return reviveTerminal(port, record, handle, input.message, nowIso, beginSend, endSend, reservation)
  }

  async function steerRunning(record: TaskRecord, handle: ManagedChildHandle, message: string, deliverAs: SendDelivery): Promise<SendOutcome> {
    if (!beginSend(record.task_id)) return evictionRefusal(record.task_id)
    try {
      if (deliverAs === "steer") await handle.steer(message)
      else await handle.followUp(message)
    } catch (error) {
      // These typed refusals happen before delivery. Never replay an ambiguous transport failure.
      if (!(error instanceof HostSessionDetachedError) && !(error instanceof SessionHeldElsewhereError)) throw error
      const fresh = tryLoad(record.task_id)
      if (fresh === undefined || fresh.status !== "running" || fresh.killed === true) {
        return { kind: "not_continuable", task_id: record.task_id,
          reason: fresh?.error_message ?? `Task ${record.task_id} ended.`, suggestion: TASK_OUTPUT_SUGGESTION }
      }
      if (fresh.notification.run_epoch !== record.notification.run_epoch) return staleSend(fresh)
      port.store.mutate(record.task_id, (current) => current.status === "running" && current.killed !== true
        ? { ...current, residency_state: "rpc_detached", suspension_reason: error instanceof SessionHeldElsewhereError ? "host_draining" : "daemon_unavailable" }
        : current)
      const queued = enqueuePending(fresh, message, deliverAs)
      await port.destruction.destroyResidentTask(record.task_id, "recovery_detach")
      return queued
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

  function hasInFlightSends(taskId: string): boolean {
    return (pendingSends.get(taskId) ?? 0) > 0
  }

  function hasPendingSends(taskId: string): boolean {
    return (pendingSends.get(taskId) ?? 0) > 0 || (tryLoad(taskId)?.pending_steering?.length ?? 0) > 0
  }

  function dropPending(taskId: string): void {
    clearPersistedQueue(taskId, undefined, "task_released")
  }

  return { sendToTask, ...createSteeringControls(port, resolve, clearPersistedQueue), notifyStarted, hasPendingSends, hasInFlightSends, dropPending }
}
