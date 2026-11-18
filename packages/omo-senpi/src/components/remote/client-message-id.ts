import { createHash, randomUUID } from "node:crypto"

/**
 * The client message id a person's send stamps on its prompt (senpi stores it on the user entry and on every record of
 * the turn that answers it), returned as the receipt's delivery_id so a follow can anchor on that turn. A send under an
 * idempotency key gets the same id each time, so a replayed receipt names the prompt that was sent; any other send a
 * fresh one.
 */
export function clientMessageIdOf(caller: string, idempotencyKey: string | undefined): string {
  if (idempotencyKey === undefined) return randomUUID()
  const hex = createHash("sha256").update(`${caller}\u0000${idempotencyKey}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
