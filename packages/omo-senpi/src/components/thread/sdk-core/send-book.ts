import { rowKey } from "@oh-my-opencode/thread-address-core"

import type { ThreadToolResult } from "../contracts"
import { createReceipts, type Receipts } from "../control/receipts"
import type { GatewayStore } from "../gateway/store"
import type { DeliveryOutcome, DeliveryTarget } from "../gateway/transport"

/**
 * Who may share a send's idempotency key (security owner's ruling, #15021): a person, a script and a session are one class,
 * so one sender's repeat through another surface is the same send; a connector and a service each have their own, so a
 * lower-trust caller can neither pre-empt nor probe a higher one's keys. The holder-side id is derived from the same three.
 */
export type SendClass = "local" | "connector" | "service"

/**
 * The one book every keyed send admits through before any transport (#15021): scoped by (resolved thread, key, class), so
 * the same key sent to one thread through the tools, the SDK and `omo thread` delivers once. A replay answers the outcome
 * and identifiers only, never the message; a different message under the key is `idempotency_conflict`, with no text from
 * either side. Accepted within one class: a guessed key shows that a send under it exists, and a principal already
 * allowed to send to the thread can take a key first. Until the engine shares one id space between prompts and
 * deliveries (senpi#7479), the guarantee holds for sends from ONE device.
 */
export async function throughSendBook(
  store: GatewayStore,
  target: DeliveryTarget,
  key: string,
  sendClass: SendClass,
  hashed: unknown,
  deliver: () => Promise<DeliveryOutcome>,
): Promise<DeliveryOutcome> {
  const receipts = bookOf(store)
  const thread = target.kind === "local" ? `here/${target.thread_id}` : rowKey(target.row)
  const scope = { principal: `send:${sendClass}:${thread}`, operation: "thread_send" as const, idempotency_key: key }
  const admission = await receipts.admit(scope, hashed)
  if (admission.kind === "answer") return replayed(admission.result)
  let sent: DeliveryOutcome
  try {
    sent = await deliver()
  } catch (error) {
    await receipts.fail(scope, error)
    throw error
  }
  await receipts.settle(scope, sent as ThreadToolResult, admission.retrying)
  return sent
}

const books = new WeakMap<GatewayStore, Receipts>()

function bookOf(store: GatewayStore): Receipts {
  const known = books.get(store)
  if (known !== undefined) return known
  const made = createReceipts(store, store.now)
  books.set(store, made)
  return made
}

const IDENTIFIERS = [
  "kind",
  "outcome",
  "delivery",
  "delivery_id",
  "thread_id",
  "effective_mode",
  "message_seq",
  "device",
  "collapsed",
] as const

/** A replayed send: its outcome and identifiers, marked deduplicated; a refusal replays as recorded. */
function replayed(result: ThreadToolResult): DeliveryOutcome {
  if (result.kind !== "ok") return result as DeliveryOutcome
  const recorded = result as Record<string, unknown>
  const kept = Object.fromEntries(
    IDENTIFIERS.filter((field) => field in recorded).map((field) => [field, recorded[field]]),
  )
  // The book's reader names the thread `thread` (thread-row.ts `currentResult`); a delivery outcome names it `thread_id`.
  const thread = recorded["thread_id"] ?? recorded["thread"]
  return {
    ...kept,
    ...(thread === undefined ? {} : { thread_id: thread }),
    deduplicated: true,
  } as unknown as DeliveryOutcome
}
