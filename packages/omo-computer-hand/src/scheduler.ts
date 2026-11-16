/** The clock and timers the host's periodic parts run on; tests drive a fake one. */
export interface Scheduler {
  now(): number
  every(ms: number, fn: () => void): () => void
  after(ms: number, fn: () => void): () => void
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const timer = setInterval(fn, ms)
    timer.unref()
    return () => clearInterval(timer)
  },
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms)
    timer.unref()
    return () => clearTimeout(timer)
  },
}
