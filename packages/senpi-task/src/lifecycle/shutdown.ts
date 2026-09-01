import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import { nowIso, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import type { ResidentHandle } from "./port"
import type { SuspendFailure, SuspendInput, SuspendSummary } from "./types"

/**
 * On session_shutdown, SUSPEND this session's children instead of destroying them: live handles
 * are still torn down (no-orphan law) but the records survive as persisted_only / rpc_detached so
 * a later session resume can revive them. The scan covers TWO populations: registry handles AND
 * pending records owned by this session/host (pending children have no handle and no session file
 * yet, so a handle-only scan would strand them). Deliberately-stopped children (cancelled/lost
 * status, or the durable killed fact) are still DISPOSED through the destruction port - they must
 * never revive. When resume_children is off, the pre-feature dispose-all behavior runs unchanged.
 */
export async function suspendOnSessionShutdown(
  context: LifecycleContext,
  input: SuspendInput,
): Promise<SuspendSummary> {
  if (context.config.resume_children === false) return disposeAllOnShutdown(context)

  const failures: SuspendFailure[] = []
  let suspendedInProcess = 0
  let suspendedRpc = 0
  let suspendedPending = 0
  let disposed = 0

  for (const handle of [...context.registry.entries()]) {
    const record = context.store.load(handle.task_id)
    if (!isOwnedChild(record, context, input.parentSessionId)) continue
    // A deliberately-stopped child routes through the destruction port with the "cancel" cause:
    // the old "shutdown" cause is removed and "cancel" is the deliberate-stop family - a cosmetic
    // event label only, with identical teardown behavior. killed === true is a durable record FACT
    // (normally carried on a status:"error" record), so it is tested explicitly here.
    if (record.killed === true || record.status === "cancelled" || record.status === "lost") {
      try {
        await destroyResidentTask(context, handle.task_id, "cancel")
        disposed += 1
      } catch (error) {
        failures.push({ task_id: handle.task_id, error: String(error) })
      }
      continue
    }
    try {
      await suspendHandle(context, handle, input.reason)
      if (handle.kind === "in-process") suspendedInProcess += 1
      else suspendedRpc += 1
    } catch (error) {
      failures.push({ task_id: handle.task_id, error: String(error) })
    }
  }

  for (const record of context.store.list().records) {
    if (record.status !== "pending" || record.killed === true) continue
    if (!isOwnedChild(record, context, input.parentSessionId)) continue
    if (context.registry.get(record.task_id) !== undefined) continue
    try {
      context.dequeuePending(record.task_id)
      context.store.transition(record.task_id, { type: "persist_only", timestamp: nowIso(context) })
      context.store.appendEvent(record.task_id, { type: "suspended", payload: { reason: input.reason } })
      suspendedPending += 1
    } catch (error) {
      failures.push({ task_id: record.task_id, error: String(error) })
    }
  }

  const summary: SuspendSummary = {
    suspended_in_process: suspendedInProcess,
    suspended_rpc: suspendedRpc,
    suspended_pending: suspendedPending,
    disposed,
    failures,
  }
  log("senpi-task session shutdown suspend", {
    parentSessionId: input.parentSessionId,
    reason: input.reason,
    ...summary,
  })
  return summary
}

// Suspend one resident handle: the registry forgets it FIRST (stale outcome tracking loses
// ownership before abort settles the turn, so no cancelled/error terminal can land on the
// suspended record), then live resources are torn down and the record is parked at its suspended
// residency. The pre-dispose steps are best-effort so dispose ALWAYS runs.
async function suspendHandle(context: LifecycleContext, handle: ResidentHandle, reason: string): Promise<void> {
  context.registry.forget(handle.task_id)
  await bestEffort(handle.task_id, "abort", () => handle.abort())
  if (handle.kind === "rpc") await bestEffort(handle.task_id, "terminate", () => handle.terminate())
  await handle.dispose()
  context.store.transition(handle.task_id, {
    type: handle.kind === "in-process" ? "persist_only" : "detach_rpc",
    timestamp: nowIso(context),
  })
  context.store.appendEvent(handle.task_id, { type: "suspended", payload: { reason } })
}

// resume_children === false restores the pre-feature behavior exactly: every resident handle is
// destroyed through the port (cancel family) and pending records are left untouched.
async function disposeAllOnShutdown(context: LifecycleContext): Promise<SuspendSummary> {
  const entries = [...context.registry.entries()]
  for (const handle of entries) {
    await destroyResidentTask(context, handle.task_id, "cancel")
  }
  const summary: SuspendSummary = {
    suspended_in_process: 0,
    suspended_rpc: 0,
    suspended_pending: 0,
    disposed: entries.length,
    failures: [],
  }
  log("senpi-task session shutdown dispose-all (resume_children=false)", { total: entries.length })
  return summary
}

function isOwnedChild(
  record: TaskRecord | null,
  context: LifecycleContext,
  parentSessionId: string,
): record is TaskRecord {
  return record !== null && record.parent_session_id === parentSessionId && record.host_pid === context.hostPid
}

async function bestEffort(taskId: string, step: "abort" | "terminate", run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    log("senpi-task suspend pre-dispose step rejected", { taskId, step, error: String(error) })
  }
}
