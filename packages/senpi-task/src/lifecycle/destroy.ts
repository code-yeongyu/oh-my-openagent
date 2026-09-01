import { log } from "@oh-my-opencode/utils"

import { delay, nowIso, type LifecycleContext } from "./context"
import type { DestroyCause, ResidentHandle } from "./port"

/**
 * THE single-writer destruction port. This is the ONLY function in the package that invokes a
 * handle's dispose()/terminate() for TERMINAL teardown, or (for a previous-process orphan) an OS
 * kill. Cancel (todo 10), LRU eviction, TTL, and reconciliation all route here so terminal state
 * never auto-disposes and every teardown is bookkept identically.
 *
 * The ONLY sibling caller of handle abort/terminate/dispose is shutdown.ts's
 * suspendOnSessionShutdown (a deliberate deviation from the single-writer rule, recorded in the
 * work plan): suspension is NOT destruction - this port's contract is terminal teardown (forget +
 * dispose transition), while suspension must keep the record continuable as persisted_only /
 * rpc_detached, so it cannot route through destroyResidentTask.
 */
export async function destroyResidentTask(
  context: LifecycleContext,
  taskId: string,
  cause: DestroyCause,
  orphanPid?: number,
): Promise<void> {
  const claimedEviction = cause === "evict" ? (context.registry.tryClaimEviction?.(taskId) ?? true) : false
  if (cause === "evict" && !claimedEviction) return
  try {
    const handle = context.registry.get(taskId)
    if (handle !== undefined) {
      await teardownHandle(handle, cause === "cancel_without_abort")
      if (cause !== "fallback_handoff") context.registry.forget(taskId)
    } else if (cause === "reconcile_lost" || cause === "ttl") {
      await terminateOrphan(context, taskId, orphanPid)
    }
    if (cause !== "fallback_handoff") recordResidency(context, taskId, cause)
  } finally {
    if (claimedEviction) context.registry.releaseEviction?.(taskId)
  }
}

async function teardownHandle(handle: ResidentHandle, skipInProcessAbort: boolean): Promise<void> {
  // The pre-dispose step (in-process abort / rpc terminate) is best-effort: an already-exited child
  // rejects it. DAG cancellation skips in-process abort only after the child's outcome has settled,
  // because Senpi can float retry rejections from both abort() and active-session dispose(). Dispose
  // must always run at that safe boundary so teardown cannot leave a resident zombie occupying a slot.
  if (handle.kind === "in-process") {
    if (!skipInProcessAbort) await bestEffort(handle.task_id, "abort", () => handle.abort())
  } else {
    await bestEffort(handle.task_id, "terminate", () => handle.terminate())
  }
  await handle.dispose()
}

async function bestEffort(taskId: string, step: "abort" | "terminate", run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    log("senpi-task teardown pre-dispose step rejected", { taskId, step, error: String(error) })
  }
}

// Kill a live orphan process left behind by a previous session: SIGTERM, then SIGKILL after the
// escalation window if it is still alive. Upholds the no-orphan law - a process nobody can reach
// must not survive reconciliation or TTL expunge. Breadcrumbs are already persisted on the `lost`
// record by the caller BEFORE this runs. For TTL the record is already tombstoned (invisible to
// load), so the sweep passes the committed record's pid explicitly as orphanPid.
async function terminateOrphan(context: LifecycleContext, taskId: string, orphanPid?: number): Promise<void> {
  const record = context.store.load(taskId)
  const pid = record === null ? orphanPid : record.execution_mode === "process" ? record.pid : undefined
  if (pid === undefined) return
  if (!context.signaller.isAlive(pid)) return

  context.signaller.signal(pid, "SIGTERM")
  context.store.appendEvent(taskId, { type: "reconcile_terminated", payload: { pid, signal: "SIGTERM" } })
  await delay(context.orphanKillDelayMs)
  if (context.signaller.isAlive(pid)) {
    context.signaller.signal(pid, "SIGKILL")
    context.store.appendEvent(taskId, { type: "reconcile_terminated", payload: { pid, signal: "SIGKILL" } })
  }
}

function recordResidency(context: LifecycleContext, taskId: string, cause: DestroyCause): void {
  if (context.store.load(taskId) === null) return
  const type = cause === "evict" ? "evict" : "dispose"
  context.store.transition(taskId, { type, timestamp: nowIso(context) })
  const eventType = cause === "evict" ? "evicted" : "destroyed"
  context.store.appendEvent(taskId, { type: eventType, payload: { cause } })
}
