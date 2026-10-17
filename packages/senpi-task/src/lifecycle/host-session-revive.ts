import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import type { LifecycleContext } from "./context"
import { hostSessionResumePath, isHostSessionRecord, type HostSessionRecord } from "./host-session"
import { parkedReason, reachRecordedHost, type HostParkedReason, type RecordedHostVerdict } from "./host-endpoint-reach"
import { markSuspensionReason, parkHostSessionRecord } from "./host-session-record"
import { deferred, reviveClaimed } from "./reconcile-reclamation"
import { claimResidencySlot } from "./residency"
import { retryDeferredScopedChild } from "./deferred-revival"
import { SCOPED_RETRY_REASONS } from "./deferred-revival-reasons"
import type { ReconcileOutcome } from "./types"

/**
 * Reviving a child that lives on the shared daemon. A host session has no pid, so nothing here can
 * (or may) signal: the only two answers are "attach/reopen it" and "leave it parked". A parked
 * record is NEVER lost - losing it would throw away a transcript the daemon still owns.
 */

export type HostSessionParkOutcome =
  | { readonly kind: "revived" }
  | { readonly kind: "suspended"; readonly reason: HostParkedReason }

export type HostSessionParkOptions = {
  /** Test seam: observe (and drive) the daemon between the bounded reconcile's attempts. */
  readonly beforeAttempt?: (attempt: number) => void
}

/**
 * The reconciliation branch for a daemon-hosted orphan: reach the RECORDED endpoint (re-ensuring it
 * unless it is this session's own), then a live session is re-attached and a parked one reopened from
 * its JSONL there. An endpoint that stays out of reach leaves the record suspended with the reason -
 * never `lost`, never signalled, never moved.
 */
export async function reconcileHostSessionOrphan(
  context: LifecycleContext,
  record: HostSessionRecord,
): Promise<ReconcileOutcome> {
  const verdict = await reachRecordedHost(context, record.host_session)
  if (verdict !== "alive") {
    const reason = parkedReason(verdict)
    parkHostSessionRecord(context, record.task_id)
    markSuspensionReason(context, record.task_id, reason)
    context.store.appendEvent(record.task_id, { type: "suspended", payload: { reason } })
    return deferred(record.task_id, verdict)
  }
  return await reviveClaimed(context, record, "rpc_detached", record.host_session.session_path)
}

/**
 * The daemon died under a live child: park it, then retry the reconcile on a bounded backoff
 * (1 s / 4 s / 16 s). If the daemon never comes back the record STAYS rpc_detached carrying
 * `daemon_unavailable`, which is what task_output reports - it is not an error and not a loss.
 */
export async function parkHostSessionOnDaemonLoss(
  context: LifecycleContext,
  taskId: string,
  options: HostSessionParkOptions = {},
): Promise<HostSessionParkOutcome> {
  const parked = context.store.load(taskId)
  if (!isHostSessionRecord(parked)) return { kind: "suspended", reason: "daemon_unavailable" }
  context.registry.forget(taskId, { path: "park" })
  parkHostSessionRecord(context, taskId)
  context.store.appendEvent(taskId, { type: "suspended", payload: { reason: "daemon_unavailable" } })

  let attempt = 0
  let verdict: RecordedHostVerdict = "host_unreachable"
  for (const backoffMs of context.hostRetry.daemonLossBackoffMs) {
    attempt += 1
    await context.hostRetry.wait(backoffMs)
    options.beforeAttempt?.(attempt)
    context.hostSessionProbe.refresh(parked.host_session.socket)
    verdict = await reachRecordedHost(context, parked.host_session)
    // An incompatible host will not become compatible by waiting; the session stays where it is.
    if (verdict === "host_incompatible") break
    if (verdict !== "alive") continue
    if (await reviveParkedHostSession(context, taskId)) return { kind: "revived" }
  }
  const reason = verdict === "alive" ? "daemon_unavailable" : parkedReason(verdict)
  markSuspensionReason(context, taskId, reason)
  return { kind: "suspended", reason }
}

async function reviveParkedHostSession(context: LifecycleContext, taskId: string): Promise<boolean> {
  const claimed = claimResidencySlot(
    context,
    taskId,
    (fresh: TaskRecord) => fresh.residency_state === "rpc_detached" && fresh.killed !== true,
  )
  if (claimed !== "claimed") return false
  const fresh = context.store.load(taskId)
  if (fresh === null) return false
  try {
    const outcome = await reviveClaimed(context, fresh, "rpc_detached", hostSessionResumePath(fresh))
    return outcome.kind === "resumed"
  } catch (error) {
    log("senpi-task host session revive after daemon loss failed", { taskId, error: String(error) })
    return false
  }
}

const DEFERRED_REASONS = new Set(["host_unreachable", "host_draining"])
const retrying = new WeakMap<LifecycleContext, Set<string>>()

/**
 * A reconcile that deferred a daemon-hosted child (its daemon did not answer, or a draining
 * generation still holds its session path) used to leave the record `running` + `rpc_detached`
 * until the NEXT parent session start, so the child's work was never observed and a DAG waited on
 * it forever (omo#9069). Each such child now gets one bounded background retry through the same
 * single-flight revival a reconcile uses, against its RECORDED session; it stops as soon as the
 * record is revived, terminal, killed, or claimed elsewhere.
 */
export function retryDeferredHostSessions(
  context: LifecycleContext,
  outcomes: readonly ReconcileOutcome[],
  parentSessionId?: string,
): void {
  const active = retrying.get(context) ?? new Set<string>()
  retrying.set(context, active)
  for (const outcome of outcomes) {
    if (outcome.kind !== "deferred") continue
    const record = context.store.load(outcome.task_id)
    const scoped = parentSessionId !== undefined && record?.parent_session_id === parentSessionId
      && SCOPED_RETRY_REASONS.has(outcome.reason ?? "")
    const host = DEFERRED_REASONS.has(outcome.reason ?? "") && isHostSessionRecord(record)
    if ((!scoped && !host) || active.has(outcome.task_id)) continue
    active.add(outcome.task_id)
    void (scoped && parentSessionId !== undefined && outcome.reason !== undefined
      ? retryDeferredScopedChild(context, outcome.task_id, parentSessionId, outcome.reason)
      : retryDeferredHostSession(context, outcome.task_id))
      .catch((error: unknown) => log("senpi-task deferred host session retry failed", { taskId: outcome.task_id, error: String(error) }))
      .finally(() => active.delete(outcome.task_id))
  }
}

async function retryDeferredHostSession(context: LifecycleContext, taskId: string): Promise<void> {
  for (const backoffMs of context.hostRetry.deferredRetryBackoffMs) {
    await context.hostRetry.wait(backoffMs)
    const fresh = context.store.load(taskId)
    if (!isHostSessionRecord(fresh) || fresh.status !== "running" || fresh.residency_state !== "rpc_detached" || fresh.killed === true) return
    context.hostSessionProbe.refresh(fresh.host_session.socket)
    if (await reviveParkedHostSession(context, taskId)) return
  }
}
