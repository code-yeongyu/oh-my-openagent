import type { GatewayStore } from "../gateway/store"
import type { DeliveryRow } from "../gateway/types"

/**
 * #14273: a close on request settles what was queued for the session before it. Every row still `queued` for
 * `durableId` that was taken in at or before `closedAt` (the close the session's transcript records, `session-target.ts`
 * `closed_at`) is refused `target_closed`, which its sender reads like any refusal, so it can never wake the closed
 * session later. A row queued after the close is a send to a closed thread: it stays and wakes the session as before.
 * Answers the session's rows that are still queued.
 */
export async function settleClosedIntake(
  store: GatewayStore,
  durableId: string,
  closedAt: number | undefined,
): Promise<readonly DeliveryRow[]> {
  const queued = (await store.list({ target_durable_id: durableId })).filter((row) => row.state === "queued")
  if (closedAt === undefined) return queued
  // A refusal that answers false lost to another path that already took the row out of `queued`: it is not queued.
  const remaining: DeliveryRow[] = []
  for (const row of queued) {
    if (row.created_at > closedAt) remaining.push(row)
    else await store.refuseQueued({ now: store.now(), delivery_id: row.delivery_id, reason: "target_closed" })
  }
  return remaining
}

/**
 * #14648: takes every row still `queued` for `durableId` out of the gateway, refused `target_closed` (its sender reads
 * "not delivered"), so no later wake opens the session for it. Answers the ids it refused; a row another path took out
 * of `queued` first (a drain claimed it) is not among them.
 */
export async function withdrawQueued(store: GatewayStore, durableId: string): Promise<readonly string[]> {
  const withdrawn: string[] = []
  for (const row of await store.list({ target_durable_id: durableId })) {
    if (row.state !== "queued") continue
    if (await store.refuseQueued({ now: store.now(), delivery_id: row.delivery_id, reason: "target_closed" }))
      withdrawn.push(row.delivery_id)
  }
  return withdrawn
}
