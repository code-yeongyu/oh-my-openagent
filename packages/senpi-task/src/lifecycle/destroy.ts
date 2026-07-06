import { delay, nowIso, type LifecycleContext } from "./context"
import type { DestroyCause, ResidentHandle } from "./port"

/**
 * THE single-writer destruction port. This is the ONLY function in the package that invokes a
 * handle's dispose()/terminate() or (for a previous-process orphan) an OS kill. Cancel (todo 10),
 * LRU eviction, TTL, session shutdown, and reconciliation all route here so terminal state never
 * auto-disposes and every teardown is bookkept identically.
 */
export async function destroyResidentTask(
  context: LifecycleContext,
  taskId: string,
  cause: DestroyCause,
): Promise<void> {
  const handle = context.registry.get(taskId)
  if (handle !== undefined) {
    await teardownHandle(handle)
    context.registry.forget(taskId)
  } else if (cause === "reconcile_lost") {
    await terminateOrphan(context, taskId)
  }
  recordResidency(context, taskId, cause)
}

async function teardownHandle(handle: ResidentHandle): Promise<void> {
  if (handle.kind === "in-process") {
    await handle.abort()
    await handle.dispose()
    return
  }
  await handle.terminate()
  await handle.dispose()
}

// Kill a live orphan process left behind by a previous session: SIGTERM, then SIGKILL after the
// escalation window if it is still alive. Upholds the no-orphan law - a process nobody can reach
// must not survive reconciliation. Breadcrumbs are already persisted on the `lost` record by the
// caller BEFORE this runs.
async function terminateOrphan(context: LifecycleContext, taskId: string): Promise<void> {
  const record = context.store.load(taskId)
  const pid = record?.pid
  if (record === null || record.execution_mode !== "process" || pid === undefined) return
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
