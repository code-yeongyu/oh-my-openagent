/**
 * The canonical replay idempotency key. The engine journals every layer-2 toolkit call under it, and
 * dori-link derives a delivery's envelope_id from the same string (UUIDv5 over the UTF-8 bytes), so
 * the form is a cross-repository contract: a JSON array string, never a re-serialized variant.
 */

export const TOOLKIT_REPLAY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function nonEmpty(name: string, value: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`)
  return value
}

/** The key of the `callIndex`-th layer-2 call of a turn: `["turn", turnId, callIndex]`. */
export function toolkitReplayKey(turnId: string, callIndex: number): string {
  if (!Number.isSafeInteger(callIndex) || callIndex < 0) throw new TypeError("callIndex must be a non-negative integer")
  return JSON.stringify(["turn", nonEmpty("turnId", turnId), callIndex])
}

/** The key of an inbound delivery the host dedupes by its own key: `["inbound", dedupeKey]`. */
export function inboundReplayKey(dedupeKey: string): string {
  return JSON.stringify(["inbound", nonEmpty("dedupeKey", dedupeKey)])
}
