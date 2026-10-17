import type { Json, PoolId, WorkpoolRecord } from "./types"

export type WorkpoolAggregateResult =
  | { readonly key: string; readonly data: Json }
  | { readonly key: string; readonly error: { readonly code: string; readonly message: string } }
export type WorkpoolAggregateMessage = {
  readonly pool_id: PoolId
  readonly generation: number
  readonly results: readonly WorkpoolAggregateResult[]
}
export type WorkpoolAggregateReceipts = {
  readonly ack: () => void
  readonly fail: (error?: unknown) => void
}
export type WorkpoolAggregatePort = {
  enqueue(message: WorkpoolAggregateMessage, receipts: WorkpoolAggregateReceipts): void
}

const terminal = new Set(["completed", "error", "cancelled"])

/**
 * No NEW worker can ever spawn for this pool: it is closed or cancelled, every item reached a
 * terminal state and no worker is still busy. The engine drops the pool's runtime kernel-tool
 * binding here, so a finished pool keeps no strong reference to the parent kernel.
 */
export function poolWorkIsFinished(pool: WorkpoolRecord): boolean {
  return pool.status !== "open" &&
    pool.items.every(item => terminal.has(item.status)) &&
    pool.workers.every(worker => worker.status !== "busy")
}

export function aggregateResults(pool: WorkpoolRecord): readonly WorkpoolAggregateResult[] | undefined {
  if (pool.status !== "closing" && pool.status !== "cancelled") return undefined
  if (pool.aggregate?.delivered === true && pool.aggregate.generation === pool.generation) return undefined
  if (pool.items.some(item => !terminal.has(item.status))) return undefined
  return pool.items.map(item => item.status === "completed"
    ? { key: item.key, data: item.data ?? null }
    : { key: item.key, error: item.error ?? { code: "cancelled", message: "Pool item did not complete." } })
}

export function deliverAggregate(
  pool: WorkpoolRecord,
  port: WorkpoolAggregatePort | undefined,
  persist: (state: { readonly delivered: boolean; readonly accepted: boolean }) => void,
  onFailure?: (error: unknown) => void,
): boolean {
  const results = aggregateResults(pool)
  if (results === undefined || port === undefined) return false
  persist({ delivered: false, accepted: true })
  try {
    port.enqueue({ pool_id: pool.pool_id, generation: pool.generation, results }, {
      ack: () => persist({ delivered: true, accepted: true }),
      fail: error => {
        persist({ delivered: false, accepted: false })
        if (error !== undefined) onFailure?.(error)
      },
    })
    return true
  } catch (error) {
    persist({ delivered: false, accepted: false })
    onFailure?.(error instanceof Error ? error : new Error(String(error)))
    return false
  }
}
