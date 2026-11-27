/**
 * The declared key order of a send's answer (#15221, "Key order is part of the contract"): its delivery state first, so a
 * reader of the first characters of the serialized answer (a cut tool line, a truncated `omo thread send --json` line)
 * reads whether the message started, was steered or waits, never the start of a link. Keys outside this list keep their
 * relative order after it.
 */
const SEND_RESULT_KEY_ORDER = [
  "kind",
  "delivery",
  "effective_mode",
  "delivery_id",
  "idempotency_key",
  "thread",
  "device",
  "deduplicated",
  "link",
] as const

export function inSendResultOrder<T extends object>(result: T): T {
  const entries = Object.entries(result)
  const rank = (key: string): number => {
    const at = (SEND_RESULT_KEY_ORDER as readonly string[]).indexOf(key)
    return at === -1 ? SEND_RESULT_KEY_ORDER.length : at
  }
  return Object.fromEntries(entries.toSorted(([a], [b]) => rank(a) - rank(b))) as T
}
