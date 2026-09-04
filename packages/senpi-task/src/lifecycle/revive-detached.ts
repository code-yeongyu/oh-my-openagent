import type { TaskRecord } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { reviveClaimed } from "./reconcile-reclamation"
import { claimResidencySlot } from "./residency"
import { newestSessionPath } from "./session-path"
import type { DetachedRevivalResult, DetachedRevivalRollbackResult } from "./port"

const LAZY_REVIVABLE_STATUSES = new Set(["completed", "error", "interrupted"])

/** Claim and reattach one terminal process only when task_send explicitly asks for it. */
export function rollbackDetachedRevival(
  context: LifecycleContext,
  prior: TaskRecord,
): DetachedRevivalRollbackResult {
  let rolledBack = false
  context.store.mutate(prior.task_id, (fresh) => {
    // Roll back ONLY the exact generation this revival wrote: our host, still resident, the epoch we
    // minted, and still running. A concurrent cancel/interrupt on that epoch has already won the
    // terminal transition; restoring the stale prior record would undo the user's action.
    if (
      fresh.host_pid !== context.hostPid ||
      fresh.residency_state !== "resident" ||
      fresh.status !== "running" ||
      fresh.notification.run_epoch !== prior.notification.run_epoch + 1
    ) return fresh
    rolledBack = true
    const {
      host_pid: _hostPid,
      final_response: _freshFinal,
      error_message: _freshError,
      run_stats: _freshStats,
      killed: _freshKilled,
      terminal_at: _freshTerminalAt,
      revive_delivery_uncertain: _freshUncertain,
      ...withoutRevivalFacts
    } = fresh
    return {
      ...withoutRevivalFacts,
      status: prior.status,
      ...(prior.final_response === undefined ? {} : { final_response: prior.final_response }),
      ...(prior.error_message === undefined ? {} : { error_message: prior.error_message }),
      ...(prior.run_stats === undefined ? {} : { run_stats: prior.run_stats }),
      ...(prior.killed === undefined ? {} : { killed: prior.killed }),
      ...(prior.terminal_at === undefined ? {} : { terminal_at: prior.terminal_at }),
      residency_state: "rpc_detached",
      notification: { ...fresh.notification, run_epoch: prior.notification.run_epoch },
      updated_at: nowIso(context),
    }
  })
  return rolledBack ? "rolled_back" : "not_owner"
}

export async function reviveDetachedTerminal(
  context: LifecycleContext,
  taskId: string,
): Promise<DetachedRevivalResult> {
  const observed = context.store.load(taskId)
  if (!isLazyRevivalCandidate(observed)) return { ok: false, reason: "task is not a detached terminal RPC child" }
  const sessionPath = newestSessionPath(context, taskId)
  if (sessionPath === undefined) return { ok: false, reason: "task transcript is unavailable" }

  const claimed = claimResidencySlot(context, taskId, (fresh) =>
    fresh.execution_mode === "process" &&
    fresh.residency_state === "rpc_detached" &&
    LAZY_REVIVABLE_STATUSES.has(fresh.status) &&
    fresh.killed !== true,
  )
  if (claimed !== "claimed") return { ok: false, reason: "task revival was claimed by another owner" }

  const fresh = context.store.load(taskId)
  if (fresh === null) return { ok: false, reason: "task disappeared during revival" }
  const outcome = await reviveClaimed(context, fresh, "rpc_detached", sessionPath, {
    allowTerminal: true,
    rollbackTerminalFailure: true,
  })
  return outcome.kind === "resumed"
    ? { ok: true }
    : { ok: false, reason: outcome.reason ?? "task revival failed" }
}

function isLazyRevivalCandidate(record: TaskRecord | null): record is TaskRecord {
  return record !== null &&
    record.execution_mode === "process" &&
    record.residency_state === "rpc_detached" &&
    LAZY_REVIVABLE_STATUSES.has(record.status) &&
    TERMINAL_STATUSES.has(record.status) &&
    record.killed !== true
}
