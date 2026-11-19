import { settleClosedIntake } from "../wake/closed-intake"
import type { GatewayStore } from "./store"

/** senpi's clean-stop record of a graceful close (senpi#7046 `session-closed`). */
export const SESSION_CLOSED_ENTRY = "session-closed"

type SessionEntry = { readonly type?: unknown; readonly customType?: unknown; readonly data?: unknown }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The delivery ids the session's newest `session-closed` record handed back unread (omo#14313), read from the shutting
 * session's own entries; `[]` when it names none.
 */
export function returnedAtClose(eventCtx: unknown): readonly string[] {
  const manager = record(eventCtx) ? eventCtx["sessionManager"] : undefined
  const getEntries = record(manager) ? manager["getEntries"] : undefined
  if (typeof getEntries !== "function") return []
  const entries = getEntries.call(manager) as readonly SessionEntry[]
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.type !== "custom" || entry.customType !== SESSION_CLOSED_ENTRY || !record(entry.data)) continue
    const returned = entry.data["returned"]
    const deliveries = record(returned) ? returned["deliveries"] : undefined
    return Array.isArray(deliveries) ? deliveries.filter((id): id is string => typeof id === "string") : []
  }
  return []
}

/**
 * A graceful close ended the session (omo#14313; `session_shutdown` carries `closed: true`): every message it did not
 * read gets one typed answer on this device's store. A delivery the engine took in and handed back (`returned`, matched
 * by the id the engine admitted it under) is refused `target_closed`, and so is every row still queued for it, including
 * a send the closing session refused while it drained. Its sender reads "not delivered", never "admitted".
 */
export async function settleGracefulClose(
  store: GatewayStore,
  durableId: string,
  returned: readonly string[],
): Promise<void> {
  const ids = new Set(returned)
  const now = store.now()
  for (const row of await store.list({ target_durable_id: durableId })) {
    if (!ids.has(row.delivery_id) && !(typeof row.ledger_id === "string" && ids.has(row.ledger_id))) continue
    await store.refuseReturned({ now, delivery_id: row.delivery_id, reason: "target_closed" })
  }
  await settleClosedIntake(store, durableId, now)
}
