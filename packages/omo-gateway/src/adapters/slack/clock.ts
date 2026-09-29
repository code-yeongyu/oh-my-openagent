/**
 * Time as the Slack adapter sees it. Everything that waits (429 Retry-After, the per-channel post
 * bucket, reconnect backoff, RTM ping/pong, dial and hello bounds, the typing budget, the idle
 * close of a typing-only line) goes through this, so tests drive time by hand and never sleep.
 */
export type SlackClock = {
  now(): number
  /** resolves after `ms`, or at once when `signal` aborts first */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** run `fn` once after `ms`; returns a cancel function */
  setTimer(fn: () => void, ms: number): () => void
}

export const realClock: SlackClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (ms <= 0 || signal?.aborted === true) return resolve()
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal?.addEventListener("abort", done, { once: true })
    }),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms)
    timer.unref()
    return () => clearTimeout(timer)
  },
}
