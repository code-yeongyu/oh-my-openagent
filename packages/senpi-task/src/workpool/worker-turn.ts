import type { PendingSteeringEntry } from "../state"
import { interactionPolicyForAgent } from "../agents/interaction-policy"
import type { TaskRecordStore } from "../store"
import { messageSha256 } from "../steering/engine-policy"
import type { WorkpoolStore } from "./store"
import { WorkpoolError, type PoolId, type WorkpoolItem } from "./types"

export type WorkerTurn = { readonly pool_id: PoolId; readonly generation: number; readonly task_id: string; readonly run_epoch: number }
export const WORKPOOL_TURN_MESSAGE = "Process the admitted workpool assignments above. Use workpool yield for each key; do not spawn or schedule tasks."
export function belongsToTurn(item: WorkpoolItem, turn: WorkerTurn): boolean {
  return item.binding?.task_id === turn.task_id && item.binding.run_epoch === turn.run_epoch && item.binding.generation === turn.generation
}

// The pool-to-task write gap is recoverable: item identity is the queue entry identity.
// Lock order is pool then task everywhere; no await occurs while either record is locked.
export function appendAssignedMessages(stores: { readonly pools: WorkpoolStore; readonly tasks: TaskRecordStore }, turn: WorkerTurn): void {
  stores.pools.mutate(turn.pool_id, pool => {
    if (pool.generation !== turn.generation || pool.status === "cancelled") return pool
    const assigned = pool.items.filter(item => belongsToTurn(item, turn) && item.status === "assigned" && item.delivery?.phase === "queued")
    const record = stores.tasks.mutate(turn.task_id, task => {
      if (task.parent_session_id !== pool.parent_session_id || task.killed === true || task.notification.run_epoch > turn.run_epoch) {
        throw new WorkpoolError("stale_assignment", "Task identity changed before queue append.")
      }
      const queue = [...(task.pending_steering ?? [])]
      for (const item of assigned) {
        if (queue.some(entry => entry.id === item.item_id)) continue
        queue.push({ id: item.item_id, deliver_as: "followUp",
          message: JSON.stringify({ pool_id: pool.pool_id, generation: pool.generation, items: [{ item_id: item.item_id, key: item.key, input: item.input }] }),
          workpool: { pool_id: pool.pool_id, generation: pool.generation, item_id: item.item_id, key: item.key, run_epoch: turn.run_epoch },
        })
      }
      return queue.length === (task.pending_steering?.length ?? 0) ? task : { ...task, pending_steering: queue }
    })
    if (record === null) throw new WorkpoolError("worker_not_continuable", "Assigned task record is missing.")
    return pool
  })
}

export function beginWorkerTurn(stores: { readonly pools: WorkpoolStore; readonly tasks: TaskRecordStore }, turn: WorkerTurn, prefix?: string) {
  let captured: { readonly entries: readonly PendingSteeringEntry[]; readonly message: string } | undefined
  stores.pools.mutate(turn.pool_id, pool => {
    if (pool.generation !== turn.generation || pool.status === "cancelled") return pool
    const assigned = pool.items.filter(item => belongsToTurn(item, turn) && item.status === "assigned")
    if (assigned.length === 0 || assigned.some(item => item.delivery?.phase !== "queued")) return pool
    const task = stores.tasks.load(turn.task_id)
    if (task === null) throw new WorkpoolError("worker_not_continuable", "Assigned task record is missing.")
    const entries = task.pending_steering ?? []
    if (assigned.some(item => !entries.some(entry => entry.id === item.item_id))) throw new WorkpoolError("store_corrupt", "Assignment has no durable steering entry.")
    // Canonical one-shot prompts discard caller context even for pools. Completion without
    // a keyed yield remains item_missing_yield; reuse remains the steering policy's refusal.
    const canonical = interactionPolicyForAgent(task.agent_type ?? "")?.promptContract === "plan-review"
    const message = prefix === undefined ? [...entries.map(entry => entry.message), WORKPOOL_TURN_MESSAGE].join("\n\n")
      : canonical ? prefix : [prefix, ...entries.map(entry => entry.message)].join("\n\n")
    captured = { entries, message }
    return { ...pool, items: pool.items.map(item => belongsToTurn(item, turn) && item.status === "assigned"
      ? { ...item, delivery: { phase: "dispatching", message_sha256: messageSha256(message) } } : item) }
  })
  return captured
}

export function acknowledgeWorkerTurn(stores: { readonly pools: WorkpoolStore; readonly tasks: TaskRecordStore }, turn: WorkerTurn, entries?: readonly PendingSteeringEntry[]): void {
  if (entries !== undefined) {
    const ids = new Set(entries.map(entry => entry.id))
    stores.tasks.mutate(turn.task_id, task => task.notification.run_epoch !== turn.run_epoch ? task : {
      ...task, pending_steering: (task.pending_steering ?? []).filter(entry => !ids.has(entry.id)),
    })
  }
  stores.pools.mutate(turn.pool_id, pool => pool.generation !== turn.generation ? pool : {
    ...pool, items: pool.items.map(item => belongsToTurn(item, turn) && item.delivery?.phase === "dispatching"
      ? { ...item, delivery: { ...item.delivery, phase: "acknowledged" } } : item),
  })
}
