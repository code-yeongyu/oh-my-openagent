/**
 * A copy of `value` holding only JSON values: properties set to `undefined` are dropped, dates
 * become ISO strings, non-finite numbers become null. Returns undefined when `value` is not an
 * object or cannot be serialised (cycles, bigint).
 *
 * The 2.x host encodes tool progress and result metadata as JSON for every event subscriber, and a
 * single non-JSON value there ("Expected JSON value") breaks the event stream for all of them.
 */
export function toJsonRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return undefined
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
