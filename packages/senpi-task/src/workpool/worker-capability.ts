import { z } from "zod"
import type { TaskRecordStore } from "../store"
import { parseInput, WorkpoolYieldSchema } from "./schema"
import type { WorkpoolStore } from "./store"
import { WorkpoolError, type WorkpoolEvent } from "./types"
import { acceptYield, refuseYield } from "./yield"

const envelope = z.strictObject({ op: z.literal("yield"), results: z.array(z.unknown()) })
export function createWorkpoolYieldCapability(store: WorkpoolStore, tasks: TaskRecordStore, emit?: (event: WorkpoolEvent) => void) {
  return (taskId: string, runEpoch: number, value: unknown) => {
    const input = parseInput(envelope, value)
    const pool = store.list().find(candidate => candidate.items.some(item => item.binding?.task_id === taskId))
    if (pool === undefined) throw new WorkpoolError("worker_unassigned", "Worker has no pool assignment.")
    if (pool.status === "cancelled" || tasks.load(taskId)?.notification.run_epoch !== runEpoch ||
      !pool.items.some(item => item.binding?.task_id === taskId && item.binding.run_epoch === runEpoch && item.binding.generation === pool.generation)) {
      throw new WorkpoolError("stale_assignment", "Yield does not identify this worker's current assignment.")
    }
    const turn = { pool_id: pool.pool_id, generation: pool.generation, task_id: taskId, run_epoch: runEpoch }
    const results = input.results.map(value => {
      const parsed = WorkpoolYieldSchema.shape.results.element.safeParse(value)
      if (!parsed.success) return refuseYield("invalid_input", "Expected one key and either JSON data or a typed error.")
      const receipt = acceptYield({ pools: store, tasks }, turn, parsed.data)
      if (receipt.status === "accepted") emit?.({ kind: "item_result", ...turn, item_id: receipt.item_id })
      return receipt
    })
    return { pool_id: pool.pool_id, generation: pool.generation, results }
  }
}
