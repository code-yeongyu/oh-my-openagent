// A clock a test moves by hand. `after` and `now` have the device service's `Timers` shape and `deadline` the local API's
// `DeadlineTimer` (handshakeTimer/requestTimer), so one clock drives both layers. `advance` moves `now` forward and fires
// every timer that came due, earliest first (armed order on a tie); a timer armed while firing that is already due fires
// in the same advance. Nothing here imports the device service, so it moves with the fakes (design v6 V12).
export type FakeClock = {
  readonly after: (ms: number, fn: () => void) => () => void
  readonly now: () => number
  readonly deadline: (expire: () => void, ms: number) => () => void
  readonly advance: (ms: number) => void
  readonly armed: () => number
}

type Armed = { readonly due: number; readonly fn: () => void }

export const fakeClock = (start = 1_790_000_000_000): FakeClock => {
  let now = start
  let nextId = 0
  const timers = new Map<number, Armed>()
  const after = (ms: number, fn: () => void): (() => void) => {
    const id = nextId++
    timers.set(id, { due: now + ms, fn })
    return () => {
      timers.delete(id)
    }
  }
  const firstDue = (until: number): [number, Armed] | undefined => {
    let first: [number, Armed] | undefined
    for (const entry of timers)
      if (entry[1].due <= until && (first === undefined || entry[1].due < first[1].due)) first = entry
    return first
  }
  return {
    after,
    now: () => now,
    deadline: (expire, ms) => after(ms, expire),
    advance: (ms) => {
      const until = now + ms
      for (let due = firstDue(until); due !== undefined; due = firstDue(until)) {
        timers.delete(due[0])
        now = due[1].due
        due[1].fn()
      }
      now = until
    },
    armed: () => timers.size,
  }
}
