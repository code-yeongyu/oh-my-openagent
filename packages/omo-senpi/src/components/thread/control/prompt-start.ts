import { setTimeout as delay } from "node:timers/promises"

import type { ThreadDelivery } from "../contracts"
import { admittedWait } from "../gateway/result"
import type { GatewayStore } from "../gateway/store"
import type { DeliveryWait } from "../gateway/types"

/**
 * How long a create waits for its first prompt to start on this device when the send answered it not started yet (a
 * new session whose control endpoint has not drained its inbox, or one the carrier has to wake). Cut to what is left of
 * the call's budget (`waitWithinCallBudget`), so the create still answers inside the call.
 */
export const FIRST_PROMPT_START_WAIT_MS = 20_000
/** What is kept of the call's budget for the create's own answer and receipt after the wait. */
export const FIRST_PROMPT_START_RESERVE_MS = 2_000
// The row's last step (admitting -> admitted, recorded by the receiving drain in the same pass as its claim) writes no
// file a watcher could follow, so the row is read again on this interval until it starts or the wait ends.
const RECHECK_MS = 250

export type PromptStart =
  | { readonly kind: "started"; readonly delivery: ThreadDelivery }
  /** Admitted to the session's queue (behind a turn, a question or a hold): it runs after what it waits on. */
  | { readonly kind: "queued"; readonly waiting_on?: DeliveryWait }
  | { readonly kind: "not_started"; readonly state: string }

/**
 * Waits up to `waitMs` for a gateway delivery on this device to be admitted: as `started` or `steered` (a turn runs it),
 * or `queued`/`held` (the session took it into its queue, #14363 review M1), each answered at once. A refused or
 * uncertain row ends the wait at once; so does a row that is gone.
 */
export async function awaitPromptStart(
  store: Pick<GatewayStore, "deliveryView">,
  deliveryId: string,
  waitMs: number,
  now: () => number = Date.now,
): Promise<PromptStart> {
  const deadline = now() + waitMs
  for (;;) {
    const row = (await store.deliveryView(deliveryId))?.row
    if (row === undefined) return { kind: "not_started", state: "missing" }
    const kind = row.admission_kind
    if ((row.state === "admitted" || row.state === "applied") && (kind === "started" || kind === "steered"))
      return { kind: "started", delivery: { kind, turn_id: String(row.turn_epoch ?? 0) } }
    if ((row.state === "admitted" || row.state === "applied") && (kind === "queued" || kind === "held")) {
      const wait = admittedWait(row)
      return wait === undefined ? { kind: "queued" } : { kind: "queued", waiting_on: wait }
    }
    if (row.state === "refused" || row.state === "uncertain") return { kind: "not_started", state: row.state }
    const left = deadline - now()
    if (left <= 0) return { kind: "not_started", state: row.state }
    await delay(Math.min(RECHECK_MS, left))
  }
}
