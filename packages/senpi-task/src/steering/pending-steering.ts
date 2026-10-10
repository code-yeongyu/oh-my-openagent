import { log } from "@oh-my-opencode/utils"
import type { PendingSteeringEntry, TaskRecord } from "../state"
import { HostSessionDetachedError, SessionHeldElsewhereError } from "../runners/rpc-host/session-wire"
import type { SendDelivery, SendOutcome, SteeringPort } from "./types"

const TASK_OUTPUT_SUGGESTION = "Use task_output to read the final result."
const NOT_FOUND_SUGGESTION = "Use /tasks to see available tasks, or task_output to read a known task."

// The durable record is the only message queue. Drain single-flight, retaining refused deliveries.
export function createPendingSteering(port: SteeringPort, tryLoad: (taskId: string) => TaskRecord | undefined) {
  const draining = new Map<string, Promise<void>>()
  const nowIso = () => new Date(port.now()).toISOString()

  function enqueuePending(record: TaskRecord, message: string, deliverAs: SendDelivery): SendOutcome {
    let position = 0
    const updated = port.store.mutate(record.task_id, (fresh) => {
      if ((fresh.status !== "pending" && fresh.status !== "running") || fresh.killed === true || fresh.cancel_requested !== undefined) return fresh
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
    if (position === 0) {
      return { kind: "not_continuable", task_id: updated.task_id,
        reason: [updated.error_message, updated.final_response].filter(Boolean).join("\n\n") || `Task ${updated.task_id} is ${updated.status}.`,
        suggestion: TASK_OUTPUT_SUGGESTION }
    }
    port.store.appendEvent(record.task_id, {
      type: "steer_queued",
      payload: { queue_position: position, deliverAs, run_epoch: updated.notification.run_epoch },
    })
    if (updated.residency_state === "resident" && port.liveHandle(record.task_id) !== undefined) {
      void notifyStarted(record.task_id)
    }
    return { kind: "queued", task_id: record.task_id, queue_position: position }
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

  function notifyStarted(taskId: string): Promise<void> {
    const existing = draining.get(taskId)
    if (existing !== undefined) return existing
    const work = Promise.resolve().then(async () => {
      while (await drainPending(taskId)) {
        // Re-read after each delivered batch: sends accepted during delivery retain their order.
      }
    }).finally(() => draining.delete(taskId))
    draining.set(taskId, work)
    return work
  }

  async function drainPending(taskId: string): Promise<boolean> {
    // Drain from the FRESH record (not a cached copy): a restarted engine must see exactly what
    // was persisted, in persisted order. Malformed entries never reach here - the store parser
    // already dropped them with a diagnostic.
    const fresh = tryLoad(taskId)
    // Pool assignments are captured by their admitted turn, never replayed as individual sends.
    const queue = fresh?.pending_steering?.filter(entry => entry.workpool === undefined)
    if (fresh === undefined || (fresh.status !== "running" && fresh.status !== "pending") || fresh.killed === true || fresh.cancel_requested !== undefined
      || fresh.residency_state !== "resident" || queue === undefined || queue.length === 0) return false
    const handle = port.liveHandle(taskId)
    if (handle === undefined) return false
    const delivered = new Set<string>()
    for (const entry of queue) {
      try {
        if (entry.deliver_as === "steer") await handle.steer(entry.message)
        else await handle.followUp(entry.message)
        port.store.appendEvent(taskId, {
          type: "steered",
          payload: { delivered: entry.deliver_as, queued: true, run_epoch: fresh.notification.run_epoch },
        })
        delivered.add(entry.id)
      } catch (error) {
        log("senpi-task steering queued delivery failed", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        })
        if (error instanceof HostSessionDetachedError || error instanceof SessionHeldElsewhereError) {
          let parked = false
          port.store.mutate(taskId, (current) => {
            if (current.status !== "running" || current.killed === true
              || current.notification.run_epoch !== fresh.notification.run_epoch) return current
            parked = true
            return { ...current, residency_state: "rpc_detached",
              suspension_reason: error instanceof SessionHeldElsewhereError ? "host_draining" : "daemon_unavailable" }
          })
          if (parked && port.liveHandle(taskId) === handle) {
            await port.destruction.destroyResidentTask(taskId, "recovery_detach")
          }
          break
        } else {
          // Other failures may have delivered before losing their acknowledgement. Preserve the
          // existing no-replay behavior rather than duplicating side effects on a later revival.
          delivered.add(entry.id)
        }
      }
    }
    clearPersistedQueue(taskId, delivered)
    return delivered.size === queue.length
  }

  return { enqueuePending, clearPersistedQueue, notifyStarted }
}
