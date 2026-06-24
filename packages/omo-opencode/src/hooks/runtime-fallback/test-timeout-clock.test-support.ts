type TestTimerID = number & ReturnType<typeof setTimeout>
type TestTimerCallback = (...args: unknown[]) => void | Promise<void>

type CapturedTimer = {
  readonly id: TestTimerID
  readonly callback: TestTimerCallback
  readonly args: readonly unknown[]
  active: boolean
  dueAt: number
}

type OriginalClock = {
  readonly setTimeout: typeof globalThis.setTimeout
  readonly clearTimeout: typeof globalThis.clearTimeout
  readonly dateNow: typeof Date.now
}

export type RuntimeFallbackTestClock = {
  readonly advanceBy: (ms: number) => Promise<void>
  readonly restore: () => void
}

let activeClock: RuntimeFallbackTestClock | undefined

export function installRuntimeFallbackTestClock(startAt = Date.now()): RuntimeFallbackTestClock {
  restoreRuntimeFallbackTestClock()

  const original: OriginalClock = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dateNow: Date.now,
  }
  const timers: CapturedTimer[] = []
  let now = startAt
  let nextTimerID = 1
  let restored = false

  const fakeSetTimeout = ((callback: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
    if (typeof callback !== "function") {
      return original.setTimeout(callback, delay, ...args)
    }

    const id = nextTimerID as TestTimerID
    nextTimerID += 1
    timers.push({
      id,
      callback: callback as TestTimerCallback,
      args,
      active: true,
      dueAt: now + Math.max(0, delay ?? 0),
    })
    return id
  }) as typeof globalThis.setTimeout

  const fakeClearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
    const timer = timers.find((candidate) => candidate.id === id)
    if (timer) {
      timer.active = false
      return
    }
    original.clearTimeout(id)
  }) as typeof globalThis.clearTimeout

  globalThis.setTimeout = fakeSetTimeout
  globalThis.clearTimeout = fakeClearTimeout
  Date.now = () => now

  const clock: RuntimeFallbackTestClock = {
    advanceBy: async (ms: number) => {
      const target = now + ms
      while (true) {
        const timer = timers
          .filter((candidate) => candidate.active && candidate.dueAt <= target)
          .sort((left, right) => left.dueAt - right.dueAt)[0]
        if (!timer) break

        now = timer.dueAt
        timer.active = false
        await timer.callback(...timer.args)
        await Promise.resolve()
      }
      now = target
      await Promise.resolve()
    },
    restore: () => {
      if (restored) return
      restored = true
      globalThis.setTimeout = original.setTimeout
      globalThis.clearTimeout = original.clearTimeout
      Date.now = original.dateNow
      if (activeClock === clock) {
        activeClock = undefined
      }
    },
  }

  activeClock = clock
  return clock
}

export function restoreRuntimeFallbackTestClock(): void {
  activeClock?.restore()
  activeClock = undefined
}
