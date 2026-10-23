import type { WorkpoolAdmission } from "./ports"
import { isColdRevivalCandidate } from "../lifecycle/revive-policy"
import { messageability } from "../state"
import { oneShotPolicyDenial } from "../steering/engine-policy"
import { reconcileWorkerTurn, reconcileWorkpool, uncertainItem } from "./reconcile"
import type { WorkpoolStore } from "./store"
import { WorkpoolError, type PoolId, type WorkpoolEvent, type WorkpoolItem, type WorkpoolRecord, type WorkpoolWorker } from "./types"

export function orderIdleWorkers(workers: readonly WorkpoolWorker[]): readonly WorkpoolWorker[] {
  return workers.filter(worker => worker.status === "idle").toSorted((a, b) =>
    a.completed_turns - b.completed_turns || a.idle_since - b.idle_since || (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0))
}

export function createWorkpoolDispatcher(ports: {
  readonly store: WorkpoolStore; readonly admission: WorkpoolAdmission
  emit(event: WorkpoolEvent): void; authorize(pool: WorkpoolRecord): void
}) {
  const { store, admission, emit } = ports
  const stores = { pools: store, tasks: admission.tasks }
  const scheduled = new Map<PoolId, ReturnType<typeof setImmediate>>()
  const pending = new Map<string, { readonly poolId: PoolId; readonly workerId?: string; cancel(): void }>()
  const completions = new Map<string, AbortController>()
  let disposed = false

  function schedule(poolId: PoolId): void {
    if (disposed || scheduled.has(poolId)) return
    // One event-loop handoff after the durable receipt; subsequent wakes are events, not polling.
    scheduled.set(poolId, setImmediate(() => {
      scheduled.delete(poolId)
      try { pump(poolId) } catch (error) {
        emit({ kind: "admission_failed", pool_id: poolId, error: {
          code: error instanceof WorkpoolError ? error.code : "store_corrupt",
          message: error instanceof Error ? error.message : "Pool admission failed.",
        } })
      }
    }))
  }
  function pump(poolId: PoolId): void {
    const pool = store.load(poolId)
    if (pool.status !== "open" && pool.status !== "closing") return
    const reservedWorkers = new Set([...pending.values()].flatMap(value => value.workerId === undefined ? [] : [value.workerId]))
    for (const snapshot of pool.items) {
      const fresh = store.load(poolId)
      const item = fresh.items.find(candidate => candidate.item_id === snapshot.item_id)
      if (item === undefined || pending.has(item.item_id)) continue
      const recovery = item.status === "assigned" && item.delivery?.phase === "queued" ? item.binding : undefined
      if (item.status !== "queued" && recovery === undefined) continue
      // A recovered turn's worker is the task as it is now: its predecessor epoch is the task's own run_epoch, not
      // binding - 1, because a rollback may have burnt the epochs in between (#9562).
      const recoveredTask = recovery !== undefined && recovery.run_epoch > 0 ? stores.tasks.load(recovery.task_id) : null
      const idle = recovery !== undefined && recovery.run_epoch > 0
        ? { ...recovery, run_epoch: recoveredTask?.notification.run_epoch ?? recovery.run_epoch - 1, status: "idle" as const, completed_turns: 0, idle_since: 0 }
        : pool.mode === "keep_alive" ? orderIdleWorkers(fresh.workers).find(worker => !reservedWorkers.has(worker.task_id)) : undefined
      if (pool.mode === "keep_alive" && idle === undefined && recovery === undefined &&
        (fresh.workers.length > 0 || [...pending.values()].some(value => value.poolId === poolId)) &&
        !admission.hasFreeSlot(pool.worker_spec.plan.model)) break
      if (idle !== undefined) reservedWorkers.add(idle.task_id)
      let boundTask: string | undefined = recovery?.task_id
      let ownsBinding = false
      let bindingRevision = item.binding?.admission_revision
      const current = (): boolean => {
        const latest = store.load(poolId)
        return !disposed && latest.generation === pool.generation && (latest.status === "open" || latest.status === "closing") &&
          latest.items.some(candidate => candidate.item_id === item.item_id && (candidate.status === "queued" ||
            (candidate.binding?.task_id === boundTask && (candidate.status === "assigned" || candidate.yield_sha256 !== undefined))))
      }
      const request = admission.request({ pool, item, ...(idle === undefined ? {} : { worker: idle }), current,
        authorize: () => ports.authorize(store.load(poolId)),
        bind: (taskId, epoch) => {
          let bound = false
          const committed = store.mutate(poolId, latest => {
            if (!current()) return latest
            const anchor = latest.items.find(candidate => candidate.item_id === item.item_id)
            if (anchor?.status !== "queued" && !(anchor?.status === "assigned" && anchor.delivery?.phase === "queued" && anchor.binding?.task_id === taskId && anchor.binding.run_epoch === epoch)) return latest
            bound = true
            boundTask = taskId
            const prior = latest.workers.find(worker => worker.task_id === taskId)
            const worker: WorkpoolWorker = { task_id: taskId, run_epoch: epoch, status: "busy", completed_turns: prior?.completed_turns ?? 0, idle_since: prior?.idle_since ?? 0 }
            return { ...latest,
              items: latest.items.map(candidate => candidate.item_id === item.item_id || (idle !== undefined && candidate.status === "queued") ||
                (candidate.status === "assigned" && candidate.delivery?.phase === "queued" && candidate.binding?.task_id === taskId &&
                  candidate.binding.run_epoch === epoch && candidate.binding.generation === pool.generation)
                ? { ...candidate, status: "assigned", binding: { task_id: taskId, run_epoch: epoch, generation: pool.generation, admission_revision: latest.revision + 1 }, delivery: { phase: "queued" } } : candidate),
              workers: [...latest.workers.filter(candidate => candidate.task_id !== taskId), worker],
            }
          })
          if (bound) {
            ownsBinding = true
            bindingRevision = committed.revision
          }
          if (!bound) pending.delete(item.item_id)
          if (bound) for (const assigned of store.load(poolId).items) {
            if (assigned.item_id === item.item_id || assigned.binding?.task_id !== taskId) continue
            pending.get(assigned.item_id)?.cancel()
            pending.delete(assigned.item_id)
          }
          return bound
        },
        event: event => {
          if (event.kind === "admission_failed") {
            pending.delete(item.item_id)
            // Queued turns remain revision-fenced; the request that began a dispatched identity owns its cleanup even if a later recovery bind replaced that revision.
            const beganThisTurn = (candidate: WorkpoolItem): boolean => candidate.status === "assigned" && candidate.delivery !== undefined &&
              candidate.delivery.phase !== "queued" && ownsBinding && candidate.binding?.task_id === event.task_id && candidate.binding?.run_epoch === event.run_epoch
            const othersTurn = (candidate: WorkpoolItem): boolean => (candidate.status === "queued" || candidate.status === "assigned") && !beganThisTurn(candidate) &&
              (candidate.binding?.admission_revision !== bindingRevision || (candidate.status === "assigned" && candidate.delivery !== undefined &&
                candidate.delivery.phase !== "queued" && (!ownsBinding || candidate.binding?.task_id !== event.task_id || candidate.binding?.run_epoch !== event.run_epoch)))
            store.mutate(poolId, latest => {
              if (latest.generation !== pool.generation) return latest
              const refused: WorkpoolItem[] = []
              const items = latest.items.map(candidate => {
                const affected = candidate.item_id === item.item_id || (boundTask !== undefined && candidate.binding?.task_id === boundTask && candidate.binding.run_epoch === event.run_epoch)
                if (!affected || (candidate.status !== "queued" && candidate.status !== "assigned") || othersTurn(candidate)) return candidate
                refused.push(candidate)
                return event.error?.code === "delivery_uncertain" ? uncertainItem(candidate, latest, event.task_id === undefined ? null : admission.tasks.load(event.task_id)) : { ...candidate, status: "error" as const, error: event.error }
              })
              for (const candidate of refused) {
                const binding = candidate.binding
                if (binding === undefined || candidate.delivery?.phase !== "queued" || event.error?.code === "delivery_uncertain") continue
                admission.tasks.mutate(binding.task_id, task => {
                  const pending = (task.pending_steering ?? []).filter(entry => entry.id !== candidate.item_id ||
                    entry.workpool?.pool_id !== poolId || entry.workpool.generation !== binding.generation ||
                    entry.workpool.item_id !== candidate.item_id || entry.workpool.run_epoch !== binding.run_epoch)
                  return pending.length === (task.pending_steering?.length ?? 0) ? task : { ...task, pending_steering: pending }
                })
              }
              return { ...latest, items, workers: latest.workers.filter(worker => {
                if (worker.task_id !== event.task_id || !refused.some(candidate =>
                  (candidate.binding?.task_id === worker.task_id && candidate.binding.run_epoch === worker.run_epoch && candidate.binding.generation === latest.generation) ||
                  (candidate.item_id === item.item_id && idle?.task_id === worker.task_id && idle.run_epoch === worker.run_epoch))) return true
                const task = admission.get(worker.task_id)
                return task?.status === "running" || (event.error?.code === "delivery_uncertain" && worker.status === "busy" && worker.run_epoch === event.run_epoch) ||
                  (worker.status === "busy" && items.some(candidate => candidate.error?.code === "delivery_uncertain" &&
                    candidate.binding?.generation === latest.generation && candidate.binding.task_id === worker.task_id && candidate.binding.run_epoch === worker.run_epoch)) ||
                  (worker.status === "idle" && task !== undefined && task.parent_session_id === latest.parent_session_id &&
                  oneShotPolicyDenial(task) === undefined && (isColdRevivalCandidate(task) ||
                    messageability(task.status, task.residency_state, task.execution_mode, task.killed) === "revive")) ||
                  latest.items.some(candidate => othersTurn(candidate) && candidate.binding?.task_id === worker.task_id &&
                    candidate.binding.run_epoch === worker.run_epoch && candidate.binding.generation === latest.generation)
              }) }
            })
            if (event.error?.code === "delivery_uncertain" && event.task_id !== undefined && event.run_epoch !== undefined) observeCompletion(pool, event.task_id, event.run_epoch)
            schedule(poolId)
          }
          if (event.kind === "dispatched" && event.task_id !== undefined && event.run_epoch !== undefined) {
            pending.delete(item.item_id)
            observeCompletion(pool, event.task_id, event.run_epoch)
            schedule(poolId)
          }
          emit(event)
        },
      })
      pending.set(item.item_id, { poolId, workerId: idle?.task_id, cancel: request.cancel })
      emit({ kind: "waiting", pool_id: poolId, item_id: item.item_id })
      admission.drain()
    }
  }
  function observeCompletion(pool: WorkpoolRecord, taskId: string, epoch: number): void {
    const identity = `${taskId}:${epoch}`
    if (completions.has(identity)) return
    const controller = new AbortController()
    completions.set(identity, controller)
    void admission.waitFor(taskId, controller.signal).then(record => {
      completions.delete(identity)
      if (disposed || record.notification.run_epoch !== epoch) return
      reconcileWorkerTurn(stores, { pool_id: pool.pool_id, generation: pool.generation, task_id: taskId, run_epoch: epoch })
      store.mutate(pool.pool_id, latest => {
        if (latest.generation !== pool.generation) return latest
        return { ...latest, workers: latest.workers.map(worker => worker.task_id === taskId && worker.run_epoch === epoch && worker.status === "busy"
          ? { ...worker, status: "idle", completed_turns: worker.completed_turns + 1, idle_since: Date.now() } : worker) }
      })
      emit({ kind: "worker_idle", pool_id: pool.pool_id, task_id: taskId, run_epoch: epoch })
      schedule(pool.pool_id)
    }).catch((error: unknown) => {
      completions.delete(identity)
      if (controller.signal.aborted) return
      emit({ kind: "admission_failed", pool_id: pool.pool_id, task_id: taskId, run_epoch: epoch,
        error: { code: "store_corrupt", message: error instanceof Error ? error.message : "Worker reconciliation failed." } })
    })
  }
  function attach(poolId: PoolId): void {
    reconcileWorkpool(stores, poolId, (taskId, epoch) => completions.has(`${taskId}:${epoch}`) || [...pending.values()].some(request => request.workerId === taskId))
    schedule(poolId)
  }
  function cancel(poolId: PoolId): void {
    const immediate = scheduled.get(poolId)
    if (immediate !== undefined) clearImmediate(immediate)
    scheduled.delete(poolId)
    for (const [id, request] of pending) {
      if (request.poolId !== poolId) continue
      request.cancel()
      pending.delete(id)
    }
  }
  // Stop scheduling and detach observers only. Child handles remain manager/lifecycle-owned.
  function stopScheduling(): void {
    disposed = true
    for (const immediate of scheduled.values()) clearImmediate(immediate)
    scheduled.clear()
    for (const request of pending.values()) request.cancel()
    pending.clear()
    for (const controller of completions.values()) controller.abort()
    completions.clear()
  }
  return { schedule, attach, cancel, stopScheduling }
}
