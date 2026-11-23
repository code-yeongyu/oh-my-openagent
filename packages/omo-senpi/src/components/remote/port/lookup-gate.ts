import { LookupFenceRefused, type RemoteLookupOutcome } from "../../thread/remote/ports"

/** One single-probe locate as sent: its answer (capped by the caller) and when the locate itself finishes. */
export type LookupStart = { readonly answer: Promise<RemoteLookupOutcome>; readonly settled: Promise<unknown> }

export type LookupGate = {
  readonly lookup: (device: string, durableId: string) => Promise<RemoteLookupOutcome>
  readonly lookupAlone: (device: string, durableId: string, waitMs: number) => Promise<RemoteLookupOutcome | undefined>
  /**
   * Any other locate the port sends (attach, watch recovery, post-create): dispatched only while no solo locate runs and
   * counted as in flight until it settles; a fence still closed after one lookup cap rejects (`lookup_fence_timeout`)
   * and dispatches nothing, so solo isolation is never traded for progress (review round 6).
   */
  readonly admit: <T>(dispatch: () => Promise<T>) => Promise<T>
}

/**
 * omo#14748 review M1/M3: the locates of one sessions port, so a solo lookup is never in flight with another one. A
 * capped answer leaves its locate running, so `lookupAlone` takes its turn among the solo lookups of every caller on the
 * port, closes the fence to new lookups, waits for every locate already in flight to finish, and only then sends its
 * own; waiting past `waitMs` sends nothing and answers undefined. The fence and the turn stay closed until the solo
 * locate itself settles (answered, failed or cancelled), not until its capped answer returns (review round 4). A lookup
 * that meets a closed fence waits for it at most `fenceWaitMs`, then answers silent without sending anything.
 */
export function createLookupGate(
  start: (device: string, durableId: string) => LookupStart,
  fenceWaitMs: number,
): LookupGate {
  const inFlight = new Set<Promise<unknown>>()
  let fence: Promise<void> | undefined
  let queue: Promise<void> = Promise.resolve()
  const track = (work: Promise<unknown>): void => {
    inFlight.add(work)
    const drop = () => void inFlight.delete(work)
    work.then(drop, drop)
  }
  const send = (device: string, durableId: string): LookupStart => {
    const started = start(device, durableId)
    track(started.settled)
    return started
  }
  const drained = async (): Promise<void> => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight])
  }
  // Admission (review round 6): the last fence check and the in-flight registration run in one synchronous step, so no
  // lookup or admitted locate can see an open fence and then dispatch after a solo lookup has closed it. undefined: the
  // fence stayed closed for the whole wait and nothing was dispatched.
  const admitted = async <T>(dispatch: () => T): Promise<T | undefined> => {
    // A monotonic clock: a wall-clock jump never stretches or skips the wait.
    const deadline = performance.now() + fenceWaitMs
    while (fence !== undefined) if (!(await within(fence, deadline - performance.now()))) return undefined
    return dispatch()
  }
  return {
    admit: async (dispatch) => {
      // Boxed: an awaited promise would be flattened, and a locate that resolves to undefined would read as not dispatched.
      const admittedWork = await admitted(() => {
        const sent = dispatch()
        track(sent)
        return { sent }
      })
      if (admittedWork === undefined) throw new LookupFenceRefused()
      return await admittedWork.sent
    },
    lookup: async (device, durableId) => {
      const started = await admitted(() => send(device, durableId))
      return started === undefined ? { kind: "silent", reason: "lookup_timeout" } : await started.answer
    },
    lookupAlone: async (device, durableId, waitMs) => {
      const deadline = performance.now() + waitMs
      const previous = queue
      let leave: () => void = () => {}
      queue = new Promise<void>((resolve) => (leave = resolve))
      if (!(await within(previous, deadline - performance.now()))) {
        void previous.then(leave)
        return undefined
      }
      let open: () => void = () => {}
      const closed = new Promise<void>((resolve) => (open = resolve))
      fence = closed
      const release = () => {
        if (fence === closed) fence = undefined
        open()
        leave()
      }
      let started: LookupStart
      try {
        if (!(await within(drained(), deadline - performance.now()))) {
          release()
          return undefined
        }
        started = send(device, durableId)
      } catch (error) {
        release()
        throw error
      }
      started.settled.then(release, release)
      return await started.answer
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
