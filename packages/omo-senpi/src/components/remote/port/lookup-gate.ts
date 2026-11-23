import type { RemoteLookupOutcome } from "../../thread/remote/ports"

/** One single-probe locate as sent: its answer (capped by the caller) and when the locate itself finishes. */
export type LookupStart = { readonly answer: Promise<RemoteLookupOutcome>; readonly settled: Promise<unknown> }

export type LookupGate = {
  readonly lookup: (device: string, durableId: string) => Promise<RemoteLookupOutcome>
  readonly lookupAlone: (device: string, durableId: string, waitMs: number) => Promise<RemoteLookupOutcome | undefined>
}

/**
 * omo#14748 review M1/M3: the locates of one sessions port, so a solo lookup is never in flight with another one. A
 * capped lookup leaves its locate running, so `lookupAlone` takes its turn among the solo lookups of every caller on the
 * port, holds every new lookup back, waits for the locates already sent to finish, and only then sends its own; waiting
 * past `waitMs` sends nothing and answers undefined. The hold lasts until its answer, and the next solo lookup again
 * waits for this one's locate to finish.
 */
export function createLookupGate(start: (device: string, durableId: string) => LookupStart): LookupGate {
  const inFlight = new Set<Promise<unknown>>()
  let held: Promise<void> | undefined
  let queue: Promise<void> = Promise.resolve()
  const send = (device: string, durableId: string): Promise<RemoteLookupOutcome> => {
    const started = start(device, durableId)
    inFlight.add(started.settled)
    const drop = () => void inFlight.delete(started.settled)
    started.settled.then(drop, drop)
    return started.answer
  }
  const drained = async (): Promise<void> => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight])
  }
  return {
    lookup: async (device, durableId) => {
      while (held !== undefined) await held
      return await send(device, durableId)
    },
    lookupAlone: async (device, durableId, waitMs) => {
      // A monotonic clock: a wall-clock jump never stretches or skips the wait.
      const deadline = performance.now() + waitMs
      const previous = queue
      let leave: () => void = () => {}
      queue = new Promise<void>((resolve) => (leave = resolve))
      if (!(await within(previous, deadline - performance.now()))) {
        void previous.then(leave)
        return undefined
      }
      let open: () => void = () => {}
      held = new Promise<void>((resolve) => (open = resolve))
      try {
        if (!(await within(drained(), deadline - performance.now()))) return undefined
        return await send(device, durableId)
      } finally {
        held = undefined
        open()
        leave()
      }
    },
  }
}

async function within(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, ms))
    timer.unref?.()
  })
  try {
    return await Promise.race([work.then(() => true as const), expired])
  } finally {
    clearTimeout(timer)
  }
}
