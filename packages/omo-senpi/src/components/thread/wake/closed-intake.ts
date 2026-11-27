import type { GatewayStore } from "../gateway/store"
import type { DeliveryRow } from "../gateway/types"

/**
 * #14273: a close on request settles what was queued for the session before it. Every row still `queued` for
 * `durableId` that was taken in at or before `closedAt` (the close the session's transcript records, `session-target.ts`
 * `closed_at`) is refused `target_closed`, which its sender reads like any refusal, so it can never wake the closed
 * session later. A thread that is retired (`retired.ts`, `retiredAt`) takes no message at all: every row queued after the
 * close is refused `target_retired`. Answers the session's rows that are still queued.
 */
export async function settleClosedIntake(
  store: GatewayStore,
  durableId: string,
  closedAt: number | undefined,
  retiredAt?: number,
): Promise<readonly DeliveryRow[]> {
  const queued = (await store.list({ target_durable_id: durableId })).filter((row) => row.state === "queued")
  if (closedAt === undefined && retiredAt === undefined) return queued
  // A refusal that answers false lost to another path that already took the row out of `queued`: it is not queued.
  const remaining: DeliveryRow[] = []
  for (const row of queued) {
    if (closedAt !== undefined && row.created_at <= closedAt)
      await store.refuseQueued({ now: store.now(), delivery_id: row.delivery_id, reason: "target_closed" })
    else if (retiredAt !== undefined)
      await store.refuseQueued({ now: store.now(), delivery_id: row.delivery_id, reason: "target_retired" })
    else remaining.push(row)
  }
  return remaining
}
