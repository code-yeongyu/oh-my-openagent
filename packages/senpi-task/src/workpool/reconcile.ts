import type { TaskRecordStore } from "../store"
import { isSpawnSpecV1, type TaskRecord } from "../state"
import { isTerminalRecord } from "../manager/manager-helpers"
import { messageSha256 } from "../steering/engine-policy"
import type { WorkpoolStore } from "./store"
import { appendAssignedMessages, belongsToTurn, type WorkerTurn } from "./worker-turn"
import { applyYield } from "./yield"
import { readYieldEvents, yieldDigest } from "./yield-event"
import type { PoolId, WorkpoolItem, WorkpoolRecord } from "./types"

type Stores = { readonly pools: WorkpoolStore; readonly tasks: TaskRecordStore }

export function uncertainItem(item: WorkpoolItem, pool: WorkpoolRecord, task: TaskRecord | null): WorkpoolItem {
  // Row-10 records predate delivery metadata: their initial prompt was persisted in the
  // launch spec; subsequent sends used this single-item payload. Never hash identity alone.
  const message = item.binding?.run_epoch === 0 && task?.spawn_spec !== undefined && isSpawnSpecV1(task.spawn_spec)
    ? task.spawn_spec.prompt : JSON.stringify({ pool_id: pool.pool_id, generation: item.binding?.generation ?? pool.generation, items: [{ item_id: item.item_id, key: item.key, input: item.input }] })
  return { ...item, status: "error", error: { code: "delivery_uncertain", message: "Delivery is uncertain. Inspect worker output and submit a NEW explicit key; this key is never retried automatically." },
    delivery: { phase: item.delivery?.phase ?? "dispatching", message_sha256: item.delivery?.message_sha256 ?? messageSha256(message) },
  }
}

export function reconcileWorkerTurn(stores: Stores, turn: WorkerTurn): void {
  const events = readYieldEvents(stores.tasks, turn)
  const record = stores.tasks.load(turn.task_id)
  const terminal = record !== null && record.notification.run_epoch === turn.run_epoch && isTerminalRecord(record)
  stores.pools.mutate(turn.pool_id, pool => {
    if (pool.generation !== turn.generation || pool.status === "cancelled") return pool
    const items = pool.items.map(item => {
      if (!belongsToTurn(item, turn) || item.yield_sha256 !== undefined || item.status === "cancelled") return item
      if (item.status !== "assigned" && item.error?.code !== "delivery_uncertain") return item
      const authoritative = events.find(event => event.item_id === item.item_id && event.result.key === item.key)
      if (authoritative !== undefined && yieldDigest(authoritative.result) === authoritative.sha256) return applyYield(item, authoritative.result)
      if (item.status !== "assigned" || item.delivery?.phase === "queued") return item
      if (terminal && item.delivery?.phase === "acknowledged") return {
        ...item, status: "error" as const, error: { code: "item_missing_yield", message: "Worker completed without a keyed yield for this item." },
      }
      return uncertainItem(item, pool, record)
    })
    return items.every((item, index) => item === pool.items[index]) ? pool : { ...pool, items }
  })
}

export function reconcileWorkpool(stores: Stores, poolId: PoolId, observed: (taskId: string, epoch: number) => boolean): void {
  const pool = stores.pools.load(poolId)
  if (pool.status === "cancelled") return
  const turns = new Map<string, WorkerTurn>()
  for (const item of pool.items) if (item.binding !== undefined && item.binding.generation === pool.generation) {
    const turn = { pool_id: poolId, ...item.binding }
    turns.set(`${turn.task_id}:${turn.run_epoch}`, turn)
  }
  for (const turn of turns.values()) {
    if (observed(turn.task_id, turn.run_epoch)) continue
    const task = stores.tasks.load(turn.task_id)
    const queued = pool.items.some(item => belongsToTurn(item, turn) && item.status === "assigned" && item.delivery?.phase === "queued")
    if (queued && task !== null && task.revive_delivery_uncertain === undefined &&
      ((isTerminalRecord(task) && task.notification.run_epoch + 1 === turn.run_epoch) || (task.status === "pending" && task.started_at === undefined && turn.run_epoch === 0))) {
      appendAssignedMessages(stores, turn)
    } else if (queued) {
      stores.pools.mutate(poolId, latest => ({ ...latest, items: latest.items.map(item => belongsToTurn(item, turn) && item.status === "assigned" ? uncertainItem(item, latest, task) : item) }))
    }
    reconcileWorkerTurn(stores, turn)
  }
  stores.pools.mutate(poolId, latest => ({ ...latest, workers: latest.workers.map(worker => {
    const task = stores.tasks.load(worker.task_id)
    return worker.status === "busy" && task !== null && isTerminalRecord(task) && task.notification.run_epoch === worker.run_epoch
      ? { ...worker, status: "idle", completed_turns: worker.completed_turns + 1, idle_since: Date.now() } : worker
  }) }))
}
