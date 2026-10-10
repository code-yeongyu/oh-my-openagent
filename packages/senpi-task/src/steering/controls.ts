import { log } from "@oh-my-opencode/utils"
import { defaultTeardownStepDeadline, withinTeardownBudget } from "../lifecycle/teardown-budget"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord } from "../state"
import { runMoved, staleCancel } from "./stale-run"
import type { CancelOptions, CancelOutcome, InterruptOutcome, SteeringPort } from "./types"

export const CANCEL_PENDING_REASON = "cancel requested, child unreachable"

export function createSteeringControls(
  port: SteeringPort,
  resolve: (idOrName: string) => TaskRecord | undefined,
  clearPersistedQueue: (taskId: string) => void,
) {
  const nowIso = (): string => new Date(port.now()).toISOString()

  // A child that never answers its abort must not hold the cancel or interrupt forever (omo#9791): past the
  // budget the caller moves on, and for a cancel the destruction that follows terminates the child (SIGKILL
  // escalation for a process child) and waits for its exit.
  function boundedAbort(handle: ManagedChildHandle, taskId: string): Promise<void> {
    return withinTeardownBudget(port.abortDeadline ?? defaultTeardownStepDeadline, { taskId, pid: handle.pid }, "abort", () => handle.abort())
  }

  async function interruptTask(idOrName: string): Promise<InterruptOutcome> {
    const record = resolve(idOrName)
    if (record === undefined) return { kind: "not_found", reason: `No task found for "${idOrName}".` }
    if (record.status !== "running") {
      return { kind: "noop", task_id: record.task_id, status: record.status, reason: `Task ${record.task_id} is ${record.status}, not running.` }
    }
    // An accepted cancel owns this run's ending: an interrupt cannot turn it into a resumable stop.
    if (record.cancel_requested !== undefined) {
      return { kind: "noop", task_id: record.task_id, status: record.status, reason: `Task ${record.task_id} has a pending cancel; it ends cancelled.` }
    }
    // Transition BEFORE abort so steering is the single terminal writer: abort settles the launch
    // outcome tracker, whose late complete/cancel transition is then rejected by terminal idempotence.
    const result = port.store.transition(record.task_id, { type: "interrupt", timestamp: nowIso() })
    if (!result.applied) {
      return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be interrupted from running.` }
    }
    const handle = port.liveHandle(record.task_id)
    if (handle !== undefined) await boundedAbort(handle, record.task_id)
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
    const expected = options?.expectedRunEpoch
    if (runMoved(record, expected)) return staleCancel(record)
    // The fence is re-checked inside the record lock by the cancel transition itself.
    const fenced = expected === undefined ? {} : { expected_run_epoch: expected }
    if (record.status === "pending") {
      const result = port.store.transition(record.task_id, {
        type: "cancel",
        timestamp: nowIso(),
        ...(reason !== undefined ? { error_message: reason } : {}),
        ...fenced,
      })
      if (!result.applied) {
        if (runMoved(result.record, expected)) return staleCancel(result.record)
        return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be cancelled from pending.` }
      }
      port.dequeuePending(record.task_id)
      clearPersistedQueue(record.task_id)
      port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: "pending", ...(reason !== undefined ? { reason } : {}) } })
      await port.destruction.destroyResidentTask(record.task_id, destructionCause)
      return { kind: "cancelled", task_id: record.task_id, previous_status: "pending" }
    }
    if (record.status !== "running") {
      // A finished child can still hold its process or session (omo#9785); cancel is the way to release it.
      if (options?.abort !== "skip" && record.residency_state === "resident" && (await port.destruction.parkTerminalResident?.(record.task_id)) === true) {
        return { kind: "released", task_id: record.task_id, status: record.status }
      }
      const reasonText = record.status === "cancelled" ? `Task ${record.task_id} is already cancelled.` : `Task ${record.task_id} is ${record.status}, not running.`
      return { kind: "noop", task_id: record.task_id, status: record.status, reason: reasonText }
    }
    const reachable = port.liveHandle(record.task_id)
    const recovering = reachable?.transportRecovering?.() === true
    // The stop already waiting on this child's connection is the cancel; a repeat joins it.
    if (record.cancel_requested !== undefined && recovering) return cancelPending(record)
    if (options?.abort !== "skip" && recovering && reachable?.stopWhenReachable !== undefined) {
      return stopWhenReachable(record, reachable, reason, expected)
    }
    // Transition BEFORE abort so this cancel is the single terminal write; the tracker's later
    // complete/cancel transition (settled by abort) is rejected by terminal idempotence.
    const runStats = port.runStatsSnapshot(record.task_id)
    const result = port.store.transition(record.task_id, {
      type: "cancel",
      timestamp: nowIso(),
      ...(reason !== undefined ? { error_message: reason } : {}),
      ...(runStats !== undefined ? { run_stats: runStats } : {}),
      ...fenced,
    })
    if (!result.applied) {
      if (runMoved(result.record, expected)) return staleCancel(result.record)
      return { kind: "noop", task_id: record.task_id, status: result.record.status, reason: `Task ${record.task_id} could not be cancelled from running.` }
    }
    const handle = port.liveHandle(record.task_id)
    // From here no transport recovery may bring the child back: a host that crashes before the stop
    // lands is reached again only to end the session (omo#9403).
    handle?.markStopping?.()
    // An exited RPC child's abort rejection must not skip destruction and leak residency.
    if (handle !== undefined && options?.abort !== "skip") {
      try {
        await boundedAbort(handle, record.task_id)
      } catch (error) {
        log("senpi-task steering cancel abort rejected", {
          taskId: record.task_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: "running", ...(reason !== undefined ? { reason } : {}) } })
    // Active in-process sessions reach their exact outcome boundary before deferred DAG disposal;
    // RPC children still terminate immediately. Lifecycle remains the sole destruction writer.
    if (options?.abort === "skip" && handle !== undefined && handle.terminate === undefined) {
      destroyAfterSettlement(handle, record.task_id)
    } else {
      await port.destruction.destroyResidentTask(record.task_id, destructionCause)
    }
    return { kind: "cancelled", task_id: record.task_id, previous_status: "running" }
  }

  // omo#9403: a child whose connection is down cannot be told to stop, and calling it cancelled would
  // be false - it may still be running on its host. The stop waits on the handle (applied on the host
  // before anything else once reachable, or the child ends when its connection never comes back), and
  // only then is the record cancelled and the child torn down, which releases its lane.
  function stopWhenReachable(record: TaskRecord, handle: ManagedChildHandle, reason: string | undefined, expected?: number): CancelOutcome {
    const stop = handle.stopWhenReachable
    if (stop === undefined) throw new Error("stopWhenReachable requires a stoppable handle")
    // Durable first: a parent that shuts down or crashes before the stop lands leaves the cancel on the
    // record, and every revival finishes it instead of running the child again.
    const requestedAt = nowIso()
    let moved: CancelOutcome | undefined
    port.store.mutate(record.task_id, (fresh) => {
      moved = runMoved(fresh, expected) ? staleCancel(fresh) : undefined
      return moved !== undefined ? fresh : {
        ...fresh,
        cancel_requested: { requested_at: requestedAt, ...(reason !== undefined ? { reason } : {}) },
      }
    })
    if (moved !== undefined) return moved
    port.stopRequested?.(record.task_id)
    port.store.appendEvent(record.task_id, { type: "cancel_requested", payload: { unreachable: true, ...(reason !== undefined ? { reason } : {}) } })
    // The pending stop is settled on every path, a failed record write included: the outcome tracker
    // waits on that settlement and ends the run as cancelled itself when this write did not land.
    const finish = async (): Promise<void> => {
      try {
        const runStats = port.runStatsSnapshot(record.task_id)
        const result = port.store.transition(record.task_id, {
          type: "cancel",
          timestamp: nowIso(),
          ...(reason !== undefined ? { error_message: reason } : {}),
          ...(runStats !== undefined ? { run_stats: runStats } : {}),
        })
        if (result.applied) {
          port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: "running", ...(reason !== undefined ? { reason } : {}) } })
        }
        await port.destruction.destroyResidentTask(record.task_id, "cancel")
      } finally {
        port.stopSettled?.(record.task_id)
      }
    }
    void stop.call(handle).then(finish, finish).catch((error: unknown) => {
      log("senpi-task deferred cancel of an unreachable child failed", { taskId: record.task_id, error: String(error) })
    })
    return cancelPending(record)
  }

  function cancelPending(record: TaskRecord): CancelOutcome {
    return { kind: "cancel_pending", task_id: record.task_id, previous_status: "running", reason: CANCEL_PENDING_REASON }
  }

  function destroyAfterSettlement(handle: ManagedChildHandle, taskId: string): void {
    const destroy = (): Promise<void> => port.destruction.destroyResidentTask(taskId, "cancel_without_abort")
    void handle.waitForOutcome().then(destroy, destroy).catch((error: unknown) => {
      log("senpi-task deferred cancel destruction rejected", { taskId, error: String(error) })
    })
  }

  return { interruptTask, cancelTask }
}
