import { log } from "@oh-my-opencode/utils"

import type { HostSessionEnd } from "../lifecycle/host-session"
import type { TaskRecord } from "../state"
import { withDroppedSteeringNotice } from "../state/queued-steering"
import { runMoved, staleCancel } from "./stale-run"
import type { CancelOutcome, SteeringPort } from "./types"

export type UnhandledHostSessionCancelDeps = {
  readonly port: SteeringPort
  readonly clearPersistedQueue: (taskId: string) => void
  readonly cancelPending: (record: TaskRecord, reason?: string) => CancelOutcome
}

/**
 * task_cancel on a daemon-hosted child this process holds no handle for (omo#11765). The session may be
 * running on a generation the recorded socket no longer reaches, so the record is cancelled only after
 * the lifecycle confirmed the session's end: until then the answer is `cancel_pending`, the obligation stays
 * on the record, and the lifecycle's driver keeps trying. A repeat cancel joins the one already pending.
 */
export function createUnhandledHostSessionCancel(deps: UnhandledHostSessionCancelDeps) {
  const { port } = deps
  const nowIso = (): string => new Date(port.now()).toISOString()

  return async function cancelUnhandledHostSession(record: TaskRecord, reason: string | undefined, expected?: number): Promise<CancelOutcome> {
    if (record.cancel_requested !== undefined) return deps.cancelPending(record)
    const errorMessage = withDroppedSteeringNotice(reason, record.pending_steering?.length ?? 0)
    let moved: CancelOutcome | undefined
    port.store.mutate(record.task_id, (fresh) => {
      moved = runMoved(fresh, expected) ? staleCancel(fresh) : undefined
      return moved !== undefined ? fresh : {
        ...fresh,
        cancel_requested: { requested_at: nowIso(), ...(errorMessage !== undefined ? { reason: errorMessage } : {}) },
      }
    })
    if (moved !== undefined) return moved
    port.store.appendEvent(record.task_id, { type: "cancel_requested", payload: { unreachable: true, ...(reason !== undefined ? { reason } : {}) } })
    const cancel = port.destruction.hostSessionCancel
    if (cancel === undefined) return deps.cancelPending(record)
    port.stopRequested?.(record.task_id)
    const finish = async (): Promise<boolean> => {
      const runStats = port.runStatsSnapshot(record.task_id)
      const result = port.store.transition(record.task_id, {
        type: "cancel",
        timestamp: nowIso(),
        ...(errorMessage !== undefined ? { error_message: errorMessage } : {}),
        ...(runStats !== undefined ? { run_stats: runStats } : {}),
      })
      if (!result.applied) return false
      deps.clearPersistedQueue(record.task_id)
      port.store.appendEvent(record.task_id, { type: "cancelled", payload: { previous_status: record.status, ...(reason !== undefined ? { reason } : {}) } })
      await port.destruction.destroyResidentTask(record.task_id, "cancel")
      return true
    }
    const settle = (): void => port.stopSettled?.(record.task_id)
    const end = await firstEnd(cancel.end(record), record.task_id)
    if (end.kind === "ended") {
      let applied = false
      try {
        applied = await finish()
      } finally {
        settle()
      }
      // Another writer ended the record first: this cancel changed nothing, as the with-handle path reports it.
      if (!applied) {
        const status = port.store.load(record.task_id)?.status ?? record.status
        return { kind: "noop", task_id: record.task_id, status, reason: `Task ${record.task_id} is ${status}, not running.` }
      }
      return { kind: "cancelled", task_id: record.task_id, previous_status: record.status,
        ...((record.pending_steering?.length ?? 0) > 0 ? { undelivered_messages: record.pending_steering?.length } : {}) }
    }
    cancel.drive(record, { ended: async () => { await finish() }, settle })
    return deps.cancelPending(record, end.kind === "pending" ? "close_pending" : end.reason)
  }
}

async function firstEnd(end: Promise<HostSessionEnd>, taskId: string): Promise<HostSessionEnd> {
  try {
    return await end
  } catch (error) {
    log("senpi-task host session cancel could not confirm the end", { taskId, error: String(error) })
    return { kind: "not_ended", reason: "end_failed" }
  }
}
