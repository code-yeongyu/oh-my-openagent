import type { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { RunPauseAdmissionHeld } from "../../../../senpi-task/src/manager/run-pause"
import type { WorkpoolEngine } from "../../../../senpi-task/src/workpool/engine"
import { createWorkpoolStore } from "../../../../senpi-task/src/workpool/store"
import type { RunPauseSource } from "./engine-run-pause"

export function createWorkpoolRunPauseSource(ports: {
  readonly stateDir: string
  readonly barrier: AdmissionBarrier
  readonly workpools: WorkpoolEngine
  ownedSessions(parent: string): readonly string[]
}): RunPauseSource {
  const store = createWorkpoolStore(ports.stateDir)
  const owned = (parent: string) => {
    const sessions = new Set(ports.ownedSessions(parent))
    return store.list().filter(pool => sessions.has(pool.parent_session_id) && pool.status !== "cancelled")
  }
  return {
    refs: parent => owned(parent).map(pool => ({ kind: "workpool", id: pool.pool_id })),
    runRefForTask: taskId => {
      const pool = store.list().find(pool => pool.workers.some(worker => worker.task_id === taskId) || pool.items.some(item => item.binding?.task_id === taskId))
      return pool === undefined ? undefined : { kind: "workpool", id: pool.pool_id }
    },
    quiesce: (parent, pauseSeq) => {
      for (const pool of owned(parent)) ports.workpools.pauseForRun({ sessionId: pool.parent_session_id }, pool.pool_id, pauseSeq)
    },
    install: async (parent, pauseSeq, credential) => {
      for (const pool of owned(parent)) {
        const entered = ports.barrier.enter(parent, { key: `run:workpool:${pool.pool_id}`, runRef: { kind: "workpool", id: pool.pool_id } }, credential)
        if (entered.kind === "held") throw new RunPauseAdmissionHeld()
        try {
          const result = ports.workpools.resumeForRun({ sessionId: pool.parent_session_id }, pool.pool_id, pauseSeq, credential)
          if (!result.released && result.reason === "stale") throw new RunPauseAdmissionHeld()
        } finally { entered.ticket.leave() }
      }
    },
    released: parent => {
      for (const sessionId of new Set(owned(parent).map(pool => pool.parent_session_id))) ports.workpools.attach({ sessionId })
    },
    cancel: async (parent, ref) => {
      const pool = owned(parent).find(pool => ref.kind === "workpool" && pool.pool_id === ref.id)
      if (pool !== undefined) ports.workpools.cancel({ sessionId: pool.parent_session_id }, pool.pool_id)
    },
  }
}
