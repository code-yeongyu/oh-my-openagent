export type TimerHandle = ReturnType<typeof setTimeout>

export interface TimerProvider {
  readonly now: () => number
  readonly setTimeout: (callback: () => void, delayMs: number) => TimerHandle
  readonly clearTimeout: (handle: TimerHandle) => void
}

export const realTimerProvider: TimerProvider = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

/** Runs `tick` every `intervalMs` without keeping the process alive; the returned function stops it. */
export function repeatEvery(timers: TimerProvider, intervalMs: number, tick: () => void): () => void {
  let handle: TimerHandle | null = null
  const arm = () => {
    handle = timers.setTimeout(() => {
      tick()
      if (handle !== null) arm()
    }, intervalMs)
    if (typeof handle.unref === "function") handle.unref()
  }
  arm()
  return () => {
    if (handle !== null) timers.clearTimeout(handle)
    handle = null
  }
}
