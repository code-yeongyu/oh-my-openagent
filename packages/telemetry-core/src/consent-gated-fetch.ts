import { gunzipSync } from "node:zlib"

import type { TelemetryFetch } from "./types"

type FetchOptions = Parameters<TelemetryFetch>[1]
type FetchResponse = Awaited<ReturnType<TelemetryFetch>>

export type ConsentGatedFetchInput = {
  /** Read at the moment a batch would leave the process; false drops the batch unsent. */
  readonly isSendAllowed: () => boolean
  /** How many events a dropped batch held. Carries no event content. */
  readonly onDropped?: (count: number) => void
  readonly fetch?: TelemetryFetch
}

// A dropped batch is answered as accepted, so the SDK removes it from its queue instead of retrying it
// on the next flush: dropping IS the outcome, not a failure.
const ACCEPTED: FetchResponse = {
  status: 200,
  text: async () => "{\"status\":1}",
  json: async () => ({ status: 1 }),
}

/**
 * The PostHog `fetch` option, gated on consent at send time. The SDK's interval flush, its batch-size
 * flush and its shutdown flush all send through this one function, so consent withdrawn after an event
 * was queued still stops that event.
 */
export function createConsentGatedFetch(input: ConsentGatedFetchInput): TelemetryFetch {
  return async (url, options) => {
    if (input.isSendAllowed()) return (input.fetch ?? defaultFetch)(url, options)
    input.onDropped?.(await countBatchEvents(options))
    return ACCEPTED
  }
}

const defaultFetch: TelemetryFetch = (url, options) => fetch(url, options as RequestInit)

// The count is diagnostic only. Whatever a malformed body throws, Error or not, counting must not
// reject: a rejected fetch reads as a network error to the SDK, which then keeps the dropped batch.
async function countBatchEvents(options: FetchOptions): Promise<number> {
  try {
    const body = options.body
    if (body === undefined) return 0
    const bytes = typeof body === "string"
      ? new TextEncoder().encode(body)
      : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body)
    const gzipped = Object.entries(options.headers)
      .some(([name, value]) => name.toLowerCase() === "content-encoding" && value === "gzip")
    const parsed: unknown = JSON.parse(new TextDecoder().decode(gzipped ? gunzipSync(bytes) : bytes))
    if (parsed !== null && typeof parsed === "object" && "batch" in parsed && Array.isArray(parsed.batch)) {
      return parsed.batch.length
    }
    return 1
  } catch {
    return 0
  }
}
