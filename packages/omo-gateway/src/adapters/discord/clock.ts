/**
 * Time as the Discord adapter sees it. Everything that waits (heartbeats, reconnect backoff, the
 * per-channel message bucket, 429 retry_after) goes through this, so tests drive time by hand and
 * never sleep.
 */
export type DiscordClock = {
  now(): number
  sleep(ms: number): Promise<void>
  /** run `fn` once after `ms`; returns a cancel function */
  setTimer(fn: () => void, ms: number): () => void
  /** uniform in [0, 1): heartbeat jitter and invalid-session wait */
  random(): number
}

export const realClock: DiscordClock = {
  now: () => Date.now(),
  sleep: (ms) => (ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms))),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
  random: () => Math.random(),
}
