import type { WorkpoolAdmission } from "./ports"
import type { WorkpoolStore } from "./store"
import type { PoolId, WorkpoolCaller, WorkpoolRecord } from "./types"
import type { ResumeCredential } from "../pause/admission-barrier"
import { acknowledgeWorkerTurn } from "./worker-turn"

export function createPoolRunPause(ports: {
  readonly store: WorkpoolStore
  readonly admission: WorkpoolAdmission
  stop(poolId: PoolId): void
  attach(poolId: PoolId, credential?: ResumeCredential): void
}) {
  function acknowledge(pool: WorkpoolRecord): void {
    for (const worker of pool.workers) if (ports.admission.get(worker.task_id)?.status === "running") {
      acknowledgeWorkerTurn({ pools: ports.store, tasks: ports.admission.tasks }, {
        pool_id: pool.pool_id, generation: pool.generation, task_id: worker.task_id, run_epoch: worker.run_epoch,
      })
    }
  }
  function pauseForRun(caller: Pick<WorkpoolCaller, "sessionId">, poolId: string, pauseSeq: number): void {
    const pool = ports.store.owned(caller, poolId)
    if (pool.status === "cancelled" || (pool.hold?.pauseSeq ?? 0) >= pauseSeq) return
    ports.store.mutate(poolId, current => {
      if (current.status === "cancelled" || (current.hold?.pauseSeq ?? 0) >= pauseSeq) return current
      return {
        ...current, hold: { reason: "user_stop", pauseSeq },
        workers: current.workers.map(worker => worker.status === "busy" ? { ...worker, status: "paused" } : worker),
      }
    })
    ports.stop(pool.pool_id)
  }
  function resumeForRun(caller: Pick<WorkpoolCaller, "sessionId">, poolId: string, pauseSeq: number, credential?: ResumeCredential):
    { readonly released: true } | { readonly released: false; readonly reason: "stale" | "not_held" } {
    const pool = ports.store.owned(caller, poolId)
    if (pool.hold === undefined) {
      if (credential !== undefined) { acknowledge(pool); ports.attach(pool.pool_id, credential) }
      return { released: false, reason: "not_held" }
    }
    if (pool.hold.pauseSeq !== pauseSeq) return { released: false, reason: "stale" }
    const resumed = ports.store.mutate(poolId, current => {
      if (current.hold?.pauseSeq !== pauseSeq) return current
      const { hold: _hold, ...resumed } = current
      return { ...resumed, workers: current.workers.map(worker => {
        if (worker.status !== "paused") return worker
        const task = ports.admission.get(worker.task_id)
        if (task?.status === "paused") return worker
        const terminal = task !== undefined && task.status !== "pending" && task.status !== "running"
        return terminal ? { ...worker, status: "idle", completed_turns: worker.completed_turns + 1, idle_since: Date.now() }
          : { ...worker, status: "busy" }
      }) }
    })
    if (resumed.hold !== undefined) return { released: false, reason: "stale" }
    acknowledge(resumed)
    ports.attach(pool.pool_id, credential)
    return { released: true }
  }
  return { pauseForRun, resumeForRun }
}
