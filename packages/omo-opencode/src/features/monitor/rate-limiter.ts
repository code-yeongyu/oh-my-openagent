/** Batches a monitor may deliver at once before the rate limit applies. */
export const MONITOR_EVENT_BURST = 10
/** After the burst, one batch per this interval. */
export const MONITOR_EVENT_REFILL_MS = 2_000

/**
 * A token bucket over event batches: a quiet monitor can deliver a burst at once, a noisy one is held to about one
 * batch every two seconds. Dropped batches stay in the output file and are reported as a count with the next one.
 */
export class MonitorRateLimiter {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly now: () => number,
    private readonly burst = MONITOR_EVENT_BURST,
    private readonly refillMs = MONITOR_EVENT_REFILL_MS,
  ) {
    this.tokens = burst
    this.lastRefill = now()
  }

  tryTake(): boolean {
    const now = this.now()
    const refilled = Math.floor((now - this.lastRefill) / this.refillMs)
    if (refilled > 0) {
      this.tokens = Math.min(this.burst, this.tokens + refilled)
      this.lastRefill += refilled * this.refillMs
    }
    if (this.tokens <= 0) return false
    this.tokens -= 1
    return true
  }
}
