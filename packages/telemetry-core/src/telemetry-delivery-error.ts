// 400 (malformed batch) and 413 (too large) are answers about the event itself: sending the same bytes
// again can never succeed. Every other failure (5xx, 408, 429, other 4xx, network, timeout) is retryable.
const PERMANENT_STATUSES: ReadonlySet<number> = new Set([400, 413])

/** A send the server did not accept. `permanent` means a retry of the same event can never succeed. */
export class TelemetryDeliveryError extends Error {
  readonly permanent: boolean
  readonly status: number | undefined

  constructor(status: number | undefined, cause?: unknown) {
    super(status === undefined ? "telemetry event was not delivered (no response)" : `telemetry event was rejected with HTTP ${status}`, { cause })
    this.name = "TelemetryDeliveryError"
    this.status = status
    this.permanent = status !== undefined && PERMANENT_STATUSES.has(status)
  }
}
