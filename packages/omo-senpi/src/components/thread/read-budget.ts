import { THREAD_READ_DEFAULT_BYTES, THREAD_READ_MAX_BYTES } from "./contracts/fields"
import type { ThreadToolFailure } from "./errors"
import { refusal } from "./refusal-texts"

/** A read's own byte budget: the default when it names none, refused when it is not a positive whole number or passes the cap. */
export function readBudget(
  maxBytes: number | undefined,
): { readonly kind: "ok"; readonly maxBytes: number } | { readonly kind: "error"; readonly error: ThreadToolFailure } {
  if (maxBytes === undefined) return { kind: "ok", maxBytes: THREAD_READ_DEFAULT_BYTES }
  const slots = {
    max_bytes: String(maxBytes),
    cap: String(THREAD_READ_MAX_BYTES),
    default: String(THREAD_READ_DEFAULT_BYTES),
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    return { kind: "error", error: refusal("read.max_bytes_invalid", slots) }
  if (maxBytes > THREAD_READ_MAX_BYTES) return { kind: "error", error: refusal("read.max_bytes_over_cap", slots) }
  return { kind: "ok", maxBytes }
}

/**
 * The entries a slice returns: in order until the next would pass `maxBytes`. The first entry taken always ships even
 * when it alone overruns the budget, so a page can never stall on an oversized entry. `from: "end"` fills the budget
 * from the newest entry backward (a first read, which must end at the latest message, #14173) and still returns the
 * entries oldest first. Every thread_read source applies it.
 */
export function takeWithinBudget<T>(
  window: readonly T[],
  maxBytes: number,
  from: "start" | "end" = "start",
): { readonly selected: readonly T[]; readonly encodedBytes: number } {
  const selected: T[] = []
  let encodedBytes = 0
  for (const entry of from === "start" ? window : [...window].reverse()) {
    const size = Buffer.byteLength(JSON.stringify(entry), "utf8")
    if (selected.length > 0 && encodedBytes + size > maxBytes) break
    selected.push(entry)
    encodedBytes += size
  }
  if (from === "end") selected.reverse()
  return { selected, encodedBytes }
}
