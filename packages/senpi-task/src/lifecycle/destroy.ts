import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import { delay, nowIso, type LifecycleContext } from "./context"
import { endClosingFallbackChild } from "./fallback-closing-child"
import { closeHostSessionConfirmed } from "./host-session-close"
import { isHostSessionRecord } from "./host-session"
import type { DestroyCause, ResidentHandle } from "./port"
import { withinTeardownBudget } from "./teardown-budget"

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
/**
 * What an orphan (a child with no live handle in this process) looks like to the destruction port.
 * A TTL expunge has already tombstoned its record, so the committed copy travels with the request.
 */
export type OrphanTarget = {
  readonly pid?: number
  readonly record?: TaskRecord
}

export async function destroyResidentTask(
  context: LifecycleContext,
  taskId: string,
  cause: DestroyCause,
  orphan?: OrphanTarget,
): Promise<void> {
  if (cause === "recovery_detach") {
    // A typed pre-delivery refusal says nothing about the daemon's running turn. dispose drops
    // only our protocol connection; abort/terminate would close the session we intend to reattach.
    const handle = context.registry.get(taskId)
    try {
      if (handle !== undefined) {
        await withinTeardownBudget(context.teardownStepDeadline, { taskId, pid: handle.pid }, "dispose", () => handle.dispose())
      }
    } finally {
      context.registry.forget(taskId)
    }
    return
  }
  const claimedEviction = cause === "evict" ? (context.registry.tryClaimEviction?.(taskId) ?? true) : false
  if (cause === "evict" && !claimedEviction) return
  // Deliberate teardown drops the child's runtime parent kernel-tool binding: nothing may keep a
  // strong reference to a kernel this child can never be revived onto. Parking never lands here.
  if (cause !== "fallback_handoff") context.kernelToolBindings?.release(taskId)
  try {
    const handle = context.registry.get(taskId)
    if (handle !== undefined) {
      try {
        await teardownHandle(context, handle, cause === "cancel_without_abort")
        context.failedTeardowns.delete(taskId)
      } catch (error) {
        context.failedTeardowns.add(taskId)
        throw error
      } finally {
        if (cause !== "fallback_handoff") context.registry.forget(taskId)
        if (cause === "revive_failure") recordRevivalFailure(context, taskId)
      }
      // A daemon child whose stop could not reach its host (the transport was down, or crash recovery
      // gave up) may still hold its session there: the cancel ends it once the host answers.
      if (handle.kind !== "in-process" && (cause === "cancel" || cause === "cancel_without_abort")) await closeParkedSession(context, taskId)
    } else if (cause === "reconcile_lost" || cause === "ttl" || cause === "revive_failure") {
      await terminateOrphan(context, taskId, orphan)
      if (cause === "revive_failure") recordRevivalFailure(context, taskId)
    } else if (cause === "cancel" || cause === "cancel_without_abort") {
      await closeParkedSession(context, taskId)
    }
    // Runtime fallback starts the next model only once the failed rung's child is confirmed gone: the
    // handle's own teardown is best-effort and bounded, so it cannot tell a refused close from a done one.
    if (cause === "fallback_handoff") await confirmClosingChildGone(context, taskId)
    if (cause !== "fallback_handoff" && cause !== "revive_failure") recordResidency(context, taskId, cause)
  } finally {
    if (claimedEviction) context.registry.releaseEviction?.(taskId)
  }
}

async function confirmClosingChildGone(context: LifecycleContext, taskId: string): Promise<void> {
  const record = context.store.load(taskId)
  if (record === null || (await endClosingFallbackChild(context, record))) return
  throw new Error("the failed model's child could not be confirmed closed")
}

// A host-session handle's terminate() IS `abort` then `close_session` (runners/rpc-host/handle.ts),
// so the rpc branch below is exactly right for it: no pid is involved on either side.
async function teardownHandle(context: LifecycleContext, handle: ResidentHandle, skipInProcessAbort: boolean): Promise<void> {
  // The pre-dispose step (in-process abort / rpc terminate) is best-effort: an already-exited child
  // rejects it. DAG cancellation skips in-process abort only after the child's outcome has settled,
  // because Senpi can float retry rejections from both abort() and active-session dispose(). Dispose
  // must always run at that safe boundary so teardown cannot leave a resident zombie occupying a slot.
  const target = { taskId: handle.task_id, pid: handle.pid }
  const bounded = (step: "abort" | "terminate" | "dispose", run: () => Promise<void>) =>
    withinTeardownBudget(context.teardownStepDeadline, target, step, run)
  if (handle.kind === "in-process") {
    if (!skipInProcessAbort) await bestEffort(handle.task_id, "abort", () => bounded("abort", () => handle.abort()))
  } else {
    await bestEffort(handle.task_id, "terminate", () => bounded("terminate", () => handle.terminate()))
  }
  await bounded("dispose", () => handle.dispose())
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
async function terminateOrphan(context: LifecycleContext, taskId: string, orphan?: OrphanTarget): Promise<void> {
  const record = context.store.load(taskId) ?? orphan?.record ?? null
  // A stopped runtime-fallback handoff can still name its failed rung's child; it is an orphan too.
  if (record !== null) await endClosingFallbackChild(context, record)
  // A daemon session is ended through the single close writer, never a signal: the only pid on the
  // other end is the machine-wide daemon's, which belongs to no child (invariant I1).
  if (isHostSessionRecord(record)) {
    if (!(await context.hostSessionProbe.sessionLive(record.host_session))) return
    await closeOrphanSession(context, taskId, record.host_session, record.spawn_spec?.cwd)
    return
  }
  const pid = record === null ? orphan?.pid : record.execution_mode === "process" ? record.pid : undefined
  if (pid === undefined) return
  if (context.signaller.isAlive(pid)) {
    context.signaller.signal(pid, "SIGTERM")
    context.store.appendEvent(taskId, { type: "reconcile_terminated", payload: { pid, signal: "SIGTERM" } })
    await delay(context.orphanKillDelayMs)
    if (context.signaller.isAlive(pid)) {
      context.signaller.signal(pid, "SIGKILL")
      context.store.appendEvent(taskId, { type: "reconcile_terminated", payload: { pid, signal: "SIGKILL" } })
    }
  }
  // The pid is consumed: its process is gone or was just killed, and the OS may hand the number to an
  // unrelated process. A later sweep (TTL) must not find it on the record and signal that process.
  if (record !== null) forgetConsumedPid(context, taskId, pid)
}

// A `lost` record keeps its pid: TTL reads it as the pid-dead proof and never signals it, only retains
// the record while that pid is alive.
function forgetConsumedPid(context: LifecycleContext, taskId: string, pid: number): void {
  context.store.mutate(taskId, (fresh) => {
    if (fresh.pid !== pid || fresh.status === "lost") return fresh
    const { pid: _consumed, ...rest } = fresh
    return rest
  })
}

// A cancelled child this process holds no handle for (it parked, or its connection was let go) may
// still run on its host and keep committing: the cancel ends that session there (omo#9403).
async function closeParkedSession(context: LifecycleContext, taskId: string): Promise<void> {
  const record = context.store.load(taskId)
  if (!isHostSessionRecord(record)) return
  context.hostSessionProbe.refresh(record.host_session.socket)
  if (!(await context.hostSessionProbe.sessionLive(record.host_session))) return
  await closeOrphanSession(context, taskId, record.host_session, record.spawn_spec?.cwd)
}

async function closeOrphanSession(
  context: LifecycleContext,
  taskId: string,
  hostSession: TaskRecord["host_session"] & {},
  cwd: string | undefined,
): Promise<void> {
  // An unconfirmed close leaves the session on the record, where the TTL sweep retries it.
  await closeHostSessionConfirmed(context, taskId, hostSession, cwd)
}

function recordRevivalFailure(context: LifecycleContext, taskId: string): void {
  context.store.mutate(taskId, (fresh) => {
    // Ownership is always checked against this lifecycle context so a foreign resident cannot be
    // stripped while a previous owner is being torn down.
    if (fresh.host_pid !== context.hostPid || fresh.residency_state !== "resident") return fresh
    const { host_pid: _hostPid, ...rest } = fresh
    return {
      ...rest,
      residency_state: fresh.execution_mode === "process" ? "rpc_detached" : "persisted_only",
      updated_at: nowIso(context),
    }
  })
}

function recordResidency(context: LifecycleContext, taskId: string, cause: DestroyCause): void {
  if (context.store.load(taskId) === null) return
  const type = cause === "evict" ? "evict" : "dispose"
  context.store.transition(taskId, { type, timestamp: nowIso(context) })
  const eventType = cause === "evict" ? "evicted" : "destroyed"
  context.store.appendEvent(taskId, { type: eventType, payload: { cause } })
}
