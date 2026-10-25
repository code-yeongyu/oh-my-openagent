import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { retriesStopped } from "./deferred-revival"
import { isHostSessionRecord } from "./host-session"
import { reconcileLegacyRecord } from "./reconcile"
import { reconcileProvisionalExit } from "./provisional-exit"
import type { ReconcileOutcome } from "./types"

const retrying = new WeakMap<LifecycleContext, Set<string>>()

/** A short-lived parent must observe recovery of an already-dead child before startup returns. */
export async function reconcileDeferredDeadChildren(
  context: LifecycleContext,
  outcomes: readonly ReconcileOutcome[],
  parentSessionId?: string,
): Promise<readonly ReconcileOutcome[]> {
  return Promise.all(outcomes.map(async (outcome) => {
    const observed = legacyOwnerRecord(context, outcome, parentSessionId)
    if (observed === null || observed.pid === undefined || context.signaller.isAlive(observed.pid)) return outcome
    return await retryOwner(context, observed, {
      parentSessionId, backoffMs: context.hostRetry.daemonLossBackoffMs,
    }) ?? outcome
  }))
}

/**
 * A new session's crash sweep also visits OTHER sessions' resident children. The scoped revival
 * retry cannot take those records: a dying owner seen once at startup otherwise strands them.
 * Retry the same legacy reclamation, never scoped admission or a new prompt.
 */
export function retryDeferredLegacyOwners(
  context: LifecycleContext,
  outcomes: readonly ReconcileOutcome[],
  parentSessionId?: string,
): void {
  const active = retrying.get(context) ?? new Set<string>()
  retrying.set(context, active)
  for (const outcome of outcomes) {
    const observed = legacyOwnerRecord(context, outcome, parentSessionId)
    if (observed === null || active.has(observed.task_id)) continue
    active.add(observed.task_id)
    void retryOwner(context, observed, { parentSessionId, backoffMs: context.hostRetry.deferredRetryBackoffMs })
      .catch((error: unknown) => log("senpi-task deferred owner reconcile failed", {
        taskId: observed.task_id, error: String(error),
      }))
      .finally(() => active.delete(observed.task_id))
  }
}

function legacyOwnerRecord(
  context: LifecycleContext,
  outcome: ReconcileOutcome,
  parentSessionId: string | undefined,
): TaskRecord | null {
  if (outcome.kind !== "foreign_live_owner"
    && !(outcome.kind === "deferred" && outcome.reason === "foreign_live_owner")) return null
  const observed = context.store.load(outcome.task_id)
  // The existing scoped retry owns this session's children; daemon sessions have their own
  // recovery authority. Same-process claims can belong to a live sibling engine.
  if (observed === null || observed.parent_session_id === parentSessionId
    || isHostSessionRecord(observed) || observed.residency_state !== "resident"
    || TERMINAL_STATUSES.has(observed.status)
    || observed.host_pid === undefined || observed.host_pid === context.hostPid) return null
  return observed
}

async function retryOwner(
  context: LifecycleContext,
  observed: TaskRecord,
  options: { readonly parentSessionId: string | undefined; readonly backoffMs: readonly number[] },
): Promise<ReconcileOutcome | undefined> {
  for (const backoffMs of options.backoffMs) {
    await context.hostRetry.wait(backoffMs)
    if (retriesStopped(context, options.parentSessionId ?? observed.parent_session_id)) return
    const fresh = context.store.load(observed.task_id)
    if (fresh === null || TERMINAL_STATUSES.has(fresh.status) || fresh.residency_state !== "resident"
      || fresh.host_pid !== observed.host_pid || fresh.residency_claim !== observed.residency_claim
      || fresh.notification.run_epoch !== observed.notification.run_epoch
      || context.registry.get(fresh.task_id) !== undefined) return
    if (fresh.host_pid !== undefined && context.signaller.isAlive(fresh.host_pid)) continue
    // Reclamation revalidates the owner under the record lock. Terminal writes that win before
    // that claim or while destruction awaits are preserved by the normal reconciliation reducer.
    const outcome = await (fresh.provisional_exit === undefined
      ? reconcileLegacyRecord(context, fresh)
      : reconcileProvisionalExit(context, fresh))
    if (outcome.kind !== "foreign_live_owner") return outcome
  }
  // Exhaustion is not proof of death. A genuinely live owner keeps its record and its child.
}
