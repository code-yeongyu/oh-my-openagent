import type { TaskRecordStore } from "../store"
import { readYieldEvents, yieldDigest } from "./yield-event"
import type { WorkpoolStore } from "./store"
import { belongsToTurn, type WorkerTurn } from "./worker-turn"
import type { ItemId, WorkpoolErrorCode, WorkpoolItem, WorkpoolYield } from "./types"

export type YieldReceipt = { readonly key?: string; readonly item_id?: ItemId; readonly status: "accepted" | "duplicate" | "refused"; readonly error?: { readonly code: WorkpoolErrorCode; readonly message: string } }
export function applyYield(item: WorkpoolItem, result: WorkpoolYield): WorkpoolItem {
  const { error: _error, data: _data, ...rest } = item
  return result.error === undefined ? { ...rest, status: "completed", data: result.data, yield_sha256: yieldDigest(result) }
    : { ...rest, status: "error", error: result.error, yield_sha256: yieldDigest(result) }
}
export function refuseYield(code: WorkpoolErrorCode, message: string, key?: string): YieldReceipt {
  return { status: "refused", error: { code, message }, ...(key === undefined ? {} : { key }) }
}

export function acceptYield(stores: { readonly pools: WorkpoolStore; readonly tasks: TaskRecordStore }, turn: WorkerTurn, result: WorkpoolYield): YieldReceipt {
  let receipt: YieldReceipt = refuseYield("stale_assignment", "Key is not assigned to this worker turn.", result.key)
  stores.pools.mutate(turn.pool_id, pool => {
    if (pool.generation !== turn.generation || pool.status === "cancelled" || stores.tasks.load(turn.task_id)?.notification.run_epoch !== turn.run_epoch) return pool
    const item = pool.items.find(candidate => candidate.key === result.key && belongsToTurn(candidate, turn))
    if (item === undefined) return pool
    const sha256 = yieldDigest(result)
    if (item.yield_sha256 !== undefined) {
      receipt = item.yield_sha256 === sha256 ? { key: item.key, item_id: item.item_id, status: "duplicate" }
        : refuseYield("yield_conflict", "This item already has a different terminal yield.", item.key)
      return pool
    }
    const uncertain = item.status === "error" && item.error?.code === "delivery_uncertain"
    if ((!uncertain && item.status !== "assigned") || item.delivery?.phase === "queued") return pool
    const prior = readYieldEvents(stores.tasks, turn).find(event => event.item_id === item.item_id && event.result.key === item.key)
    if (prior !== undefined) {
      receipt = prior.sha256 === sha256 ? { key: item.key, item_id: item.item_id, status: "duplicate" }
        : refuseYield("yield_conflict", "This item already has a different durable yield event.", item.key)
      return pool
    }
    // This event is authoritative even if the subsequent pool replace fails. Recovery checks
    // its full tuple and digest; redacted event payloads cannot fabricate a replacement result.
    stores.tasks.appendEvent(turn.task_id, { type: "workpool_yield", payload: { ...turn, item_id: item.item_id, result, sha256 } })
    receipt = { key: item.key, item_id: item.item_id, status: "accepted" }
    // An uncertain item changes only during completion/restart reconciliation of this event.
    if (uncertain) return pool
    return { ...pool, items: pool.items.map(candidate => candidate.item_id === item.item_id ? applyYield(candidate, result) : candidate) }
  })
  return receipt
}
