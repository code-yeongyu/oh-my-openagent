import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { isAbsolute } from "node:path"
import { parseTaskId } from "../state/id"
import { createTaskRecordStore } from "../store"
import { createWorkpoolWorkerTool } from "../tools/workpool"
import { WORKPOOL_STATE_DIR_ENV, WORKPOOL_TASK_ID_ENV } from "../team/member-extension/identity"
import { createWorkpoolStore } from "./store"
import { WorkpoolError } from "./types"
import { createWorkpoolYieldCapability } from "./worker-capability"

// Uses the existing member-extension bundle, but never starts a team poller or task engine.
// The host supplies identity through the dedicated process launch, not tool arguments.
export function registerProcessWorkpoolWorker(pi: Pick<ExtensionAPI, "registerTool">, env: NodeJS.ProcessEnv = process.env): boolean {
  const stateDir = env[WORKPOOL_STATE_DIR_ENV]
  const taskIdValue = env[WORKPOOL_TASK_ID_ENV]
  if (stateDir === undefined && taskIdValue === undefined) return false
  if (stateDir === undefined || !isAbsolute(stateDir) || taskIdValue === undefined) throw new WorkpoolError("worker_unassigned", "Incomplete worker launch identity.")
  const taskId = parseTaskId(taskIdValue)
  const tasks = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })
  const store = createWorkpoolStore(stateDir)
  const get = (id: string) => tasks.load(id) ?? undefined
  if (!store.list().some(pool => pool.workers.some(worker => worker.task_id === taskId))) throw new WorkpoolError("worker_unassigned", "Worker has no durable binding.")
  pi.registerTool(createWorkpoolWorkerTool({ workpools: { yieldResults: createWorkpoolYieldCapability(store, tasks) }, taskId,
    runEpoch: () => get(taskId)?.notification.run_epoch ?? -1 }))
  return true
}
