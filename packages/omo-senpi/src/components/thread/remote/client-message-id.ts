import { createHash, randomUUID } from "node:crypto"

/**
 * The client message id a person's send stamps on its prompt (senpi stores it on the user entry and on every record of
 * the turn that answers it), returned as the receipt's delivery_id so a follow can anchor on that turn. A send under an
 * idempotency key gets the same id each time, so a replayed receipt names the prompt that was sent; any other send a
 * fresh one.
 */
function clientMessageIdOf(caller: string, idempotencyKey: string | undefined): string {
  if (idempotencyKey === undefined) return randomUUID()
  const hex = createHash("sha256").update(`${caller}\u0000${idempotencyKey}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * The principal class a keyed id is scoped to (#15021, the security owner's ruling): person, script and session are one
 * class; a connector and a service are each their own, so a lower-trust class can neither pre-empt nor probe another
 * class's keys.
 */
export type PrincipalClass = "first_party" | "connector" | "service"

/** The thread a keyed id names: its durable id when its device publishes one, else its listing place on that device. */
export type KeyedThread = { readonly device: string; readonly session: string; readonly durable?: string | undefined }

/**
 * The id the holder admits a keyed send under (#15021): derived from the THREAD, the key and the principal class, not
 * the sender, so the same
 * key sent to one thread as a tool's delivery, a script's prompt or a person's command line is one message wherever it
 * came from. Until the engine keeps one id book for prompts and deliveries (code-yeongyu/senpi#7479) the holder dedupes
 * a prompt and a delivery apart; the sending device's one receipt book is what holds across surfaces there. A send
 * without a key gets a fresh id.
 */
export const keyedMessageId = (
  thread: KeyedThread,
  principalClass: PrincipalClass,
  idempotencyKey: string | undefined,
): string =>
  clientMessageIdOf(
    `${principalClass}:thread:${thread.durable ?? `${thread.device}/${thread.session}`}`,
    idempotencyKey,
  )
