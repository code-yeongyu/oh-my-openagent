import { log } from "@oh-my-opencode/utils"
import { isFallbackHandoff } from "../lifecycle/fallback-handoff"
import { withDroppedSteeringNotice } from "../state/queued-steering"
import type { TaskRecordStore } from "../store"

export type StrandedHandoffFailure = {
  readonly taskId: string
  readonly epoch: number
  readonly owner: number | undefined
  readonly nextModel: string
  readonly error: unknown
}

/** Fence the failed handoff and include its queue count before its one terminal notification. */
export function failStrandedHandoff(store: TaskRecordStore, timestamp: string, input: StrandedHandoffFailure): void {
  const reason = input.error instanceof Error ? input.error.message : String(input.error)
  log("senpi-task runtime fallback teardown rejected", { taskId: input.taskId, error: reason })
  let owned = false
  let undelivered = 0
  store.mutate(input.taskId, fresh => {
    if (!isFallbackHandoff(fresh) || fresh.status !== "running"
      || fresh.notification.run_epoch !== input.epoch || fresh.host_pid !== input.owner) return fresh
    owned = true
    undelivered = fresh.pending_steering?.length ?? 0
    // Keep the closing child's identity until its cleanup owner takes over. The queue ends here, inside
    // the one failure result, so a later teardown has nothing left to report a second time.
    const { fallback_handoff_epoch: _ended, pending_steering: _dropped, ...rest } = fresh
    return rest
  })
  if (!owned) return
  const message = withDroppedSteeringNotice(
    `Runtime fallback could not close the failed model's child (${reason}); ${input.nextModel} was not started.`,
    undelivered,
  )
  const failed = store.transition(input.taskId, { type: "fail", timestamp, error_message: message })
  if (undelivered > 0) store.appendEvent(input.taskId, { type: "steer_dropped", payload: { count: undelivered, reason: "fallback_failed" } })
  if (failed.applied) {
    store.appendEvent(input.taskId, {
      type: "task_fallback_teardown_failed", payload: { error_message: reason, next_model: input.nextModel },
    })
  }
}
