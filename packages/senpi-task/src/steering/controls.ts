import { log } from "@oh-my-opencode/utils"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord } from "../state"
import type { CancelOptions, CancelOutcome, InterruptOutcome, SteeringPort } from "./types"

export function createSteeringControls(
  port: SteeringPort,
  resolve: (idOrName: string) => TaskRecord | undefined,
  clearPersistedQueue: (taskId: string) => void,
) {
  const nowIso = (): string => new Date(port.now()).toISOString()

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
    // An exited RPC child's abort rejection must not skip destruction and leak residency.
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
    // Active in-process sessions reach their exact outcome boundary before deferred DAG disposal;
    // RPC children still terminate immediately. Lifecycle remains the sole destruction writer.
    if (options?.abort === "skip" && handle !== undefined && handle.terminate === undefined) {
      destroyAfterSettlement(handle, record.task_id)
    } else {
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

  return { interruptTask, cancelTask }
}
