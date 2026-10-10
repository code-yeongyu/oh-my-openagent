import { log } from "@oh-my-opencode/utils"
import type { TaskRecord } from "../state"
import type { LifecycleContext } from "./context"
import { retriesStopped } from "./deferred-revival"
import { PERMANENT_REVIVAL_REASONS } from "./deferred-revival-reasons"
import { isHostSessionRecord } from "./host-session"
import type { IdleReclaimerTimer, LifecycleDeps } from "./port"
import { reconcileScopedRevival } from "./reconcile-revival"
import { isSuspendedResidency } from "./revival-selection"
import { newestSessionPath } from "./session-path"
import { suspendHandle } from "./shutdown"
import { expireSuspendedChild, isSuspensionExpiry } from "./suspended-expiry"
import type { ReconcileResult } from "./types"

// Five minutes matches the sustained deferred-revival backoff (300 s), well beyond the 1/4/16 s
// daemon-loss and 20 s generation-drain budgets. A live parent must get an answer, not wait for
// another session_start. Persist the deadline so neither restart nor retry bookkeeping renews it.
export const LIVE_PARENT_SUSPENSION_BUDGET_MS = 300_000
const RETRY_MS = 5_000

type Episode = {
  readonly epoch: number
  readonly deadline: number
  busy: boolean
  expiring: boolean
}

export function startLiveParentRecovery(
  context: LifecycleContext,
  subscribe: LifecycleDeps["onStoreMutation"],
) {
  const episodes = new Map<string, Episode>()
  let timer: IdleReclaimerTimer | undefined
  let disposed = false
  let scheduled = false
  let reconciling = 0

  function owned(record: TaskRecord): boolean {
    return (
      !disposed &&
      !retriesStopped(context, record.parent_session_id) &&
      context.registry.ownsRecord?.(record) === true
    )
  }

  function eligible(record: TaskRecord): boolean {
    // All suspension causes (including old records with none) qualify. Terminal statuses, notably
    // interrupted and completed idle evictions, do not represent unfinished runs. Accepted user
    // cancels retain their existing confirmed-stop semantics.
    return (
      owned(record) &&
      (record.status === "pending" || record.status === "running") &&
      (record.residency_state !== "resident" || record.suspension_reason !== undefined
        || (record.recovery_deadline_at !== undefined && context.registry.get(record.task_id) === undefined)
        || isSuspensionExpiry(record)) &&
      record.cancel_requested === undefined &&
      (record.killed !== true || isSuspensionExpiry(record))
    )
  }

  async function attempt(record: TaskRecord, episode: Episode): Promise<void> {
    try {
      if (!eligible(record)) return
      if (isSuspensionExpiry(record) || context.now() >= episode.deadline
        || PERMANENT_REVIVAL_REASONS.has(record.revival_deferred_reason ?? record.suspension_reason ?? "")) {
        await expireSuspendedChild(context, record, () => owned(record))
        return
      }
      // A live foreign owner may release its claim within the budget. Do not start a second run
      // beside it; at expiry the normal stop/close path must end it (or disclose unconfirmed close).
      if (record.host_pid !== undefined && record.host_pid !== context.hostPid
        && context.signaller.isAlive(record.host_pid)) return
      if (context.registry.get(record.task_id) !== undefined) return
      if (isHostSessionRecord(record)) context.hostSessionProbe.refresh(record.host_session.socket)
      // Legacy evicted/disposed unfinished records have no live run. Put them through the same
      // admission path as shutdown parks, rather than leaving an ineligible row forever.
      if (!isSuspendedResidency(record.residency_state) && context.registry.get(record.task_id) === undefined) {
        context.store.mutate(record.task_id, (fresh) =>
          eligible(fresh) && fresh.residency_claim === record.residency_claim
            ? { ...fresh, residency_state: fresh.execution_mode === "process" ? "rpc_detached" : "persisted_only" }
            : fresh,
        )
      }
      // Same fenced batch admission and reviveClaimed as session_start, restricted to this task.
      // Other suspended children must not be claimed by a per-child retry.
      const excludeTaskIds = new Set(context.reconcileAdmission.excludeTaskIds)
      for (const other of context.store.list().records)
        if (other.task_id !== record.task_id) excludeTaskIds.add(other.task_id)
      const revival = reconcileScopedRevival(
        {
          ...context,
          deferUnresumable: true,
          reconcileAdmission: { ...context.reconcileAdmission, excludeTaskIds },
        },
        record.parent_session_id,
        [record],
        (id) => newestSessionPath(context, id),
      )
      context.store.appendEvent(record.task_id, {
        type: "live_parent_recovery_started",
        payload: {},
      })
      const outcomes = await revival
      const outcome = outcomes.find((entry) => entry.task_id === record.task_id)
      if (outcome?.kind === "deferred" && outcome.reason !== undefined) {
        const reason = outcome.reason
        const deferred = context.store.mutate(record.task_id, (fresh) =>
          eligible(fresh) && fresh.notification.run_epoch === episode.epoch
            ? { ...fresh, revival_deferred_reason: reason }
            : fresh,
        )
        if (deferred !== null && (outcome.permanent === true || PERMANENT_REVIVAL_REASONS.has(reason))) {
          await expireSuspendedChild(context, deferred, () => owned(deferred))
        }
      }
      // Shutdown can win while respawn is in flight, exactly as in deferred scoped revival.
      if (!owned(record)) {
        const handle = context.registry.get(record.task_id)
        if (handle !== undefined) {
          await suspendHandle(context, handle, "revived_after_shutdown")
        }
      }
      context.store.appendEvent(record.task_id, {
        type: "live_parent_recovery_attempt",
        payload: { outcomes },
      })
    } catch (error) {
      log("senpi-task live parent recovery failed", {
        taskId: record.task_id,
        error: String(error),
      })
    } finally {
      episode.busy = false
      const fresh = context.store.load(record.task_id)
      if (fresh === null || !eligible(fresh) || fresh.notification.run_epoch !== episode.epoch)
        episodes.delete(record.task_id)
      // A failed attempt may have held the claim across the deadline. Settle its expiry now.
      else if (context.now() >= episode.deadline && !isSuspensionExpiry(fresh)) scan()
    }
  }

  function inspect(retry: boolean): void {
    if (disposed) return
    for (const record of context.store.list().records) {
      let episode = episodes.get(record.task_id)
      if (!eligible(record)) {
        episodes.delete(record.task_id)
        continue
      }
      if (episode !== undefined && episode.epoch !== record.notification.run_epoch) {
        episodes.delete(record.task_id)
        episode = undefined
      }
      const first = episode === undefined
      episode ??= {
        epoch: record.notification.run_epoch,
        deadline: record.recovery_deadline_at ?? context.now() + LIVE_PARENT_SUSPENSION_BUDGET_MS,
        busy: false,
        expiring: false,
      }
      episodes.set(record.task_id, episode)
      if (record.recovery_deadline_at === undefined) {
        const deadline = episode.deadline
        const epoch = episode.epoch
        context.store.mutate(record.task_id, (fresh) =>
          eligible(fresh) && fresh.notification.run_epoch === epoch
            ? { ...fresh, recovery_deadline_at: fresh.recovery_deadline_at ?? deadline }
            : fresh,
        )
      }
      if (episode.expiring) continue
      if (context.now() >= episode.deadline && context.registry.get(record.task_id) === undefined) {
        episode.expiring = true
        const currentEpisode = episode
        void expireSuspendedChild(context, record, () => owned(record))
          .catch((error: unknown) => log("senpi-task recovery deadline cleanup failed", { taskId: record.task_id, error: String(error) }))
          .finally(() => { currentEpisode.expiring = false })
        continue
      }
      if (episode.busy || reconciling > 0) continue
      if (!first && !retry && context.now() < episode.deadline) continue
      episode.busy = true
      void attempt(record, episode)
    }
    if (episodes.size > 0 && timer === undefined) {
      timer = context.idleReclaimerScheduler.setInterval(() => inspect(true), RETRY_MS)
      timer.unref?.()
    } else if (episodes.size === 0 && timer !== undefined) {
      context.idleReclaimerScheduler.clearInterval(timer)
      timer = undefined
    }
  }

  function scan(): void {
    if (scheduled || disposed) return
    scheduled = true
    // Mutations can run under a store wrapper or before parkOwned forgets its old handle. Inspect
    // only after that synchronous write/forget finishes, not recursively inside a record lock.
    queueMicrotask(() => {
      scheduled = false
      inspect(false)
    })
  }
  const unsubscribe = subscribe?.(scan)
  return {
    scan,
    reconcile: async (run: () => Promise<ReconcileResult>): Promise<ReconcileResult> => {
      reconciling += 1
      try {
        // A parent restart may not revive a run whose persisted deadline already elapsed.
        for (const record of context.store.list().records) {
          if (eligible(record) && (isSuspensionExpiry(record)
            || (record.recovery_deadline_at !== undefined && context.now() >= record.recovery_deadline_at)
            || PERMANENT_REVIVAL_REASONS.has(record.revival_deferred_reason ?? record.suspension_reason ?? ""))) {
            await expireSuspendedChild(context, record, () => owned(record))
          }
        }
        inspect(false)
        const result = await run()
        for (const outcome of result.outcomes) {
          if (outcome.kind !== "deferred" || !(outcome.permanent === true || PERMANENT_REVIVAL_REASONS.has(outcome.reason ?? ""))) continue
          const record = context.store.load(outcome.task_id)
          if (record !== null && eligible(record)) {
            await expireSuspendedChild(context, record, () => owned(record))
          }
        }
        return result
      } finally {
        reconciling -= 1
        scan()
      }
    },
    dispose: () => {
      disposed = true
      unsubscribe?.()
      episodes.clear()
      if (timer !== undefined) context.idleReclaimerScheduler.clearInterval(timer)
    },
  }
}
