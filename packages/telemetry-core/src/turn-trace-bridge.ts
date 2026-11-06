/**
 * The process-wide hand-off of a session's current turn traceparent to the task engine, which
 * launches delegated children from another bundle of the same process. The registry lives on
 * `globalThis` under a registered symbol so every bundled copy of this module shares one map.
 * Keys are raw session ids and never leave the process; only the W3C value reaches a child.
 */

const REGISTRY = Symbol.for("omo.telemetry.turn-traceparent.v1")
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/u

function registry(): Map<string, string> {
  const existing: unknown = Reflect.get(globalThis, REGISTRY)
  if (existing instanceof Map) return existing
  const created = new Map<string, string>()
  Reflect.set(globalThis, REGISTRY, created)
  return created
}

/** A version-00 W3C `traceparent` with lowercase, non-zero trace and span ids. */
export function isTraceparent(value: unknown): value is string {
  return typeof value === "string" && TRACEPARENT.test(value)
}

export function publishTurnTraceparent(sessionId: string, traceparent: string): void {
  if (isTraceparent(traceparent)) registry().set(sessionId, traceparent)
}

/** With `expected`, clears only while that value is still the published one. */
export function clearTurnTraceparent(sessionId: string, expected?: string): void {
  const map = registry()
  if (expected === undefined || map.get(sessionId) === expected) map.delete(sessionId)
}

export function readTurnTraceparent(sessionId: string): string | undefined {
  return registry().get(sessionId)
}
