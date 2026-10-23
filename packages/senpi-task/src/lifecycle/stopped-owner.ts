import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import { withDroppedSteeringNotice } from "../state/queued-steering"
import { nowIso, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import type { SuspendFailure, SuspendInput, SuspendSummary } from "./types"

// A session's own task: the record whose child is that session. Once that task is cancelled, lost or
// killed it can never be resumed, so nothing could ever collect a child its session suspended (#10818).
// A cancel that is still landing counts too: the unreachable-child stop and the revival's pending
// cancel both end the session BEFORE the record turns cancelled, with only cancel_requested set.
// A hosted child's record has no child_session_id (the host reports the durable id only later), so the
// session's own task id from its host session context identifies it too.
export function stoppedOwnerTask(context: LifecycleContext, sessionId: string, ownTaskId?: string): TaskRecord | undefined {
  return context.store.list().records.find((record) =>
    (record.child_session_id === sessionId || (ownTaskId !== undefined && record.task_id === ownTaskId))
    && (record.killed === true || record.status === "cancelled" || record.status === "lost"
      || record.cancel_requested !== undefined))
}

// Stops every child the stopped owner's session holds, live or still pending, through the one
// destruction port, with the same steps as steering's cancel: the record is cancelled BEFORE teardown
// (so the child's own settling outcome is rejected), its queued steering is dropped with a notice, and
// a live handle is marked stopping so a recovering transport ends the session instead of resuming it.
export async function stopOwnedChildren(
  context: LifecycleContext,
  input: SuspendInput,
  owner: TaskRecord,
): Promise<SuspendSummary> {
  const failures: SuspendFailure[] = []
  let disposed = 0
  const reason = `parent task ${owner.task_id} was ${owner.killed === true ? "killed" : owner.status === "running" ? "cancelled" : owner.status}`
  for (const record of context.store.list().records) {
    if (record.parent_session_id !== input.parentSessionId || record.host_pid !== context.hostPid) continue
    if (context.registry.get(record.task_id) === undefined && record.status !== "pending") continue
    try {
      if (record.status === "pending") context.dequeuePending(record.task_id)
      if (record.status === "pending" || record.status === "running") cancelChild(context, record.task_id, reason)
      // Read after the cancel: a launch that admitted the pending child meanwhile has registered it by now.
      context.registry.get(record.task_id)?.markStopping?.()
      await destroyResidentTask(context, record.task_id, "cancel")
      disposed += 1
    } catch (error) {
      failures.push({ task_id: record.task_id, error: String(error) })
    }
  }
  const summary: SuspendSummary = {
    suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed, failures, stopped_owner: owner.task_id,
  }
  log("senpi-task session shutdown stopped the children of a stopped task", {
    parentSessionId: input.parentSessionId, owner: owner.task_id, ...summary,
  })
  return summary
}

// Every fact comes from the fresh record, never the shutdown's list() snapshot: the child may have
// started, settled or received a queued message since.
function cancelChild(context: LifecycleContext, taskId: string, reason: string): void {
  const before = context.store.load(taskId)
  if (before === null) return
  const result = context.store.transition(taskId, {
    type: "cancel", timestamp: nowIso(context),
    error_message: withDroppedSteeringNotice(reason, before.pending_steering?.length ?? 0) ?? reason,
  })
  // A child that settled on its own in the meantime keeps its own outcome: no cancelled event for it.
  if (!result.applied) return
  let dropped = 0
  context.store.mutate(taskId, (fresh) => {
    dropped = fresh.pending_steering?.length ?? 0
    if (dropped === 0) return fresh
    const { pending_steering: _dropped, ...rest } = fresh
    return rest
  })
  if (dropped > 0) context.store.appendEvent(taskId, { type: "steer_dropped", payload: { count: dropped, reason: "cancelled" } })
  context.store.appendEvent(taskId, { type: "cancelled", payload: { previous_status: before.status, reason } })
}
