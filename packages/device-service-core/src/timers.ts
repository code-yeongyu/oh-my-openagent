import type { DeadlineTimer } from "./local-api/client-connection.ts"

/**
 * The clock seam (design one-remote-module v6 section 9): `after` arms `fn` to run once after `ms` and returns its cancel,
 * `now` reads the clock in epoch milliseconds. Every deadline of the device service runs on it, so a test passes a fake
 * clock and fires a 120 s bound without waiting for it.
 */
export type Timers = {
  readonly after: (ms: number, fn: () => void) => () => void
  readonly now: () => number
}

// The device service's own waits never keep the process alive: a long-lived engine-side client, not a CLI verb.
export const realTimers: Timers = {
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
  now: () => Date.now(),
}

/** The local API client's handshake and request bounds (`ConnectOptions.handshakeTimer`/`requestTimer`) on `timers`. */
export const deadlineTimerOf =
  (timers: Timers): DeadlineTimer =>
  (expire, ms) =>
    timers.after(ms, expire)
