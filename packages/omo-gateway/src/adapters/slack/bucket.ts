import type { SlackClock } from "./clock"

/**
 * Slack allows about one message per second per channel. A token bucket per channel (capacity
 * `burst`, refilled at `perSecond`) paces every message write; writes to one channel are serialized
 * so two concurrent sends can never both take the last token.
 */
export class ChannelTokenBucket {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()
  private readonly tails = new Map<string, Promise<void>>()

  constructor(
    private readonly clock: SlackClock,
    readonly perSecond = 1,
    readonly burst = 1,
  ) {}

  take(channel: string): Promise<void> {
    const turn = (this.tails.get(channel) ?? Promise.resolve()).then(() => this.wait(channel))
    this.tails.set(
      channel,
      turn.catch(() => undefined),
    )
    return turn
  }

  private refill(channel: string): { tokens: number; at: number } {
    const now = this.clock.now()
    const bucket = this.buckets.get(channel) ?? { tokens: this.burst, at: now }
    const tokens = Math.min(this.burst, bucket.tokens + ((now - bucket.at) / 1000) * this.perSecond)
    const next = { tokens, at: now }
    this.buckets.set(channel, next)
    return next
  }

  private async wait(channel: string): Promise<void> {
    const bucket = this.refill(channel)
    if (bucket.tokens >= 1) {
      this.buckets.set(channel, { tokens: bucket.tokens - 1, at: bucket.at })
      return
    }
    const waitMs = Math.ceil(((1 - bucket.tokens) / this.perSecond) * 1000)
    await this.clock.sleep(waitMs)
    this.buckets.set(channel, { tokens: 0, at: Math.max(this.clock.now(), bucket.at + waitMs) })
  }
}
