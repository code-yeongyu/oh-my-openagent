import { accessSync, constants, statSync } from "node:fs"
import { isSpawnSpecV1, type TaskRecord } from "../state"
import { acquireSessionAdmissionLease } from "./admission-lease"
import { checkReviveGeneration, isColdRevivalCandidate } from "./revive-policy"
import { nowIso, type LifecycleContext } from "./context"
import { reviveClaimed } from "./reconcile-reclamation"
import { claimResidencySlot } from "./residency"
import { newestSessionPath } from "./session-path"
import type { DetachedRevivalResult, DetachedRevivalRollbackResult } from "./port"

/** Roll back only the claim or running epoch owned by this cold revival. */
export function rollbackDetachedRevival(
  context: LifecycleContext,
  prior: TaskRecord,
): DetachedRevivalRollbackResult {
  let rolledBack = false
  context.store.mutate(prior.task_id, (fresh) => {
    const claimed = fresh.status === prior.status && fresh.notification.run_epoch === prior.notification.run_epoch
    const running = fresh.status === "running" && fresh.notification.run_epoch === prior.notification.run_epoch + 1
    if (fresh.host_pid !== context.hostPid || fresh.residency_state !== "resident" || fresh.killed === true || (!claimed && !running)) return fresh
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
      residency_state: prior.residency_state,
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
  if (observed === null || !isColdRevivalCandidate(observed)) return { ok: false, reason: "task is not a continuable parked child" }
  if (observed.host_pid !== undefined && observed.host_pid !== context.hostPid) return refused("foreign_owner")
  const sessionPath = newestSessionPath(context, taskId)
  if (sessionPath === undefined) return { ok: false, reason: "task transcript is unavailable" }
  const spec = observed.spawn_spec
  if (spec === undefined || (observed.execution_mode === "in-process" && !isSpawnSpecV1(spec))) {
    return { ok: false, reason: "persisted spawn spec unavailable" }
  }
  try {
    if (!statSync(spec.cwd).isDirectory()) return { ok: false, code: "cwd_unavailable", reason: "recorded cwd is not a directory" }
    accessSync(spec.cwd, constants.R_OK | constants.X_OK)
  } catch (error) {
    return { ok: false, code: "cwd_unavailable", reason: error instanceof Error ? error.message : String(error) }
  }
  if (!checkReviveGeneration(observed, context.revivePolicy)) {
    return { ok: false, code: "config_generation_mismatch", reason: "recorded config generation differs from current generation" }
  }
  // Try once: callers receive explicit contention rather than a timed retry loop.
  const acquired = await acquireSessionAdmissionLease(context.store.stateDir, observed.parent_session_id, { acquireTimeoutMs: 0 })
  if (acquired.kind === "contended") return refused("lock_contended")
  try {
    if (!acquired.lease.isOwner()) return refused("lease_lost")
    const limit = context.config.residency_max_children
    const residents = context.store.list().records.filter((record) => record.parent_session_id === observed.parent_session_id && record.residency_state === "resident").length
    if (limit !== "unlimited" && limit !== 0 && residents >= limit) return refused("residency_capacity")
    const claimed = claimResidencySlot(context, taskId, (fresh) =>
      isColdRevivalCandidate(fresh) && fresh.host_pid === observed.host_pid &&
      fresh.updated_at === observed.updated_at && fresh.notification.run_epoch === observed.notification.run_epoch,
    )
    if (claimed !== "claimed") return refused("ownership_changed")
  } finally { acquired.lease.release() }
  const fresh = context.store.load(taskId)
  if (fresh === null) return refused("record_disappeared")
  const residency = observed.execution_mode === "in-process" ? "persisted_only" : "rpc_detached"
  const outcome = await reviveClaimed(context, fresh, residency, sessionPath, {
    allowTerminal: true,
    rollbackTerminalFailure: true,
  })
  if (outcome.kind === "resumed") return { ok: true }
  return outcome.reason === "capacity"
    ? refused("lane_capacity")
    : { ok: false, reason: outcome.reason ?? "task revival failed" }
}

function refused(reason: string): DetachedRevivalResult {
  return { ok: false, code: "admission_refused", reason }
}
