import { AsyncLocalStorage } from "node:async_hooks"

// omo#14130: one thread tool call may send several commands to another device (a send's state probe, its admission and
// the state read after it; a read's pages). Each sizes its wait to what is left of the call's budget, so the whole call
// settles, typed, inside the 60 s a host-tool bridge (the eval kernel's) gives a tool call before dropping it untyped.
export const TOOL_CALL_BUDGET_MS = 50_000

/**
 * What a wait inside a call leaves for the read after it (review rounds 2-3). A read's own bound is 30 s (READ_WAIT_MS),
 * longer than this reserve, so a slow paged read after a long wait can still end as a typed request_timeout; a full 30 s
 * reserve would cap every wait at 20 s instead.
 */
export const READ_RESERVE_MS = 15_000

const scope = new AsyncLocalStorage<number>()

/** Runs `call` with every remote command inside it bounded by `deadlineMs` (epoch ms). */
export const withCallDeadline = <T>(deadlineMs: number, call: () => Promise<T>): Promise<T> =>
  scope.run(deadlineMs, call)

/** The wait a remote command may take: `bound`, cut to what is left of the enclosing call's deadline (none: `bound`). */
export function commandWaitMs(bound: number, now: number = Date.now()): number {
  const deadline = scope.getStore()
  return deadline === undefined ? bound : Math.min(bound, deadline - now)
}

/** A wait inside a call: `requested`, cut so that `reserve` of the call's budget is left for what follows (none: as asked). */
export function waitWithinCallBudget(
  requested: number,
  reserve: number = READ_RESERVE_MS,
  now: number = Date.now(),
): number {
  const deadline = scope.getStore()
  return deadline === undefined ? requested : Math.max(0, Math.min(requested, deadline - now - reserve))
}

/** Runs `work` outside any call's budget: a background task a call queued (a held re-send) outlives that call. */
export const outsideCallDeadline = <T>(work: () => T): T => scope.exit(work)

/** What a root call that can wait takes (design 4.4): the caller's signal and its deadline, in ms from the call. */
export type CallWaitOptions = { readonly signal?: AbortSignal; readonly deadline_ms?: number }

/** The clock a wait reads: epoch ms (the time commandWaitMs reads) and a one-shot timer that returns its cancel. */
export type WaitClock = {
  readonly now: () => number
  readonly after: (ms: number, fire: () => void) => () => void
}

export const SYSTEM_WAIT_CLOCK: WaitClock = {
  now: () => Date.now(),
  after: (ms, fire) => {
    const timer = setTimeout(fire, Math.max(0, ms))
    timer.unref?.()
    return () => clearTimeout(timer)
  },
}

/** Why a wait ended before its port call answered; `sent`: the call's write had been sent, so it may have acted. */
export type WaitLoss = {
  readonly reason: "cancelled" | "timeout"
  readonly sent: boolean
  readonly deadline_ms?: number
}

/** A port call's wait lost to the caller's signal or deadline; the port call itself may still be running. */
export class WaitLost extends Error {
  constructor(readonly loss: WaitLoss) {
    super(loss.reason === "cancelled" ? "The call was cancelled." : "The call's deadline passed.")
    this.name = "WaitLost"
  }
}

/**
 * One call's wait over its port calls (slice T1b). `read` and `write` each take one port call as an async thunk: before
 * it starts, an aborted signal or a passed deadline rejects with `WaitLost` and the thunk is never run; while it runs, the
 * signal's abort event or the deadline's timer rejects with `WaitLost` at once and the thunk's own outcome is dropped (a
 * late failure goes to `onLate`). Once a `write` has started, every later loss is `sent`. `scoped` runs the call inside
 * the deadline scope above, so every remote command in it is cut to what is left. Without options each is the thunk.
 */
export type CallWait = {
  readonly read: <T>(port: () => Promise<T>) => Promise<T>
  readonly write: <T>(port: () => Promise<T>) => Promise<T>
  readonly scoped: <T>(call: () => Promise<T>) => Promise<T>
  /** The loss that has already happened (signal aborted, deadline passed), else undefined. */
  readonly lost: () => WaitLoss | undefined
}

export function callWait(
  options: CallWaitOptions = {},
  clock: WaitClock = SYSTEM_WAIT_CLOCK,
  onLate: (error: unknown) => void = () => undefined,
): CallWait {
  const { signal, deadline_ms } = options
  const deadlineAt = deadline_ms === undefined ? undefined : clock.now() + deadline_ms
  let sent = false
  const loss = (reason: WaitLoss["reason"]): WaitLoss => ({
    reason,
    sent,
    ...(reason === "timeout" && deadline_ms !== undefined ? { deadline_ms } : {}),
  })
  const lost = (): WaitLoss | undefined => {
    if (signal?.aborted === true) return loss("cancelled")
    return deadlineAt !== undefined && clock.now() >= deadlineAt ? loss("timeout") : undefined
  }
  function waited<T>(port: () => Promise<T>, sends: boolean): Promise<T> {
    const before = lost()
    if (before !== undefined) return Promise.reject(new WaitLost(before))
    if (sends) sent = true
    if (signal === undefined && deadlineAt === undefined) return port()
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let cancelTimer = (): void => undefined
      const settle = (): boolean => {
        if (settled) return false
        settled = true
        cancelTimer()
        signal?.removeEventListener("abort", onAbort)
        return true
      }
      const lose = (reason: WaitLoss["reason"]): void => {
        if (settle()) reject(new WaitLost(loss(reason)))
      }
      const onAbort = (): void => lose("cancelled")
      signal?.addEventListener("abort", onAbort, { once: true })
      if (deadlineAt !== undefined) cancelTimer = clock.after(deadlineAt - clock.now(), () => lose("timeout"))
      port().then(
        (value) => {
          if (settle()) resolve(value)
        },
        (error: unknown) => {
          if (settle()) reject(error)
          else onLate(error)
        },
      )
    })
  }
  const scoped = <T>(call: () => Promise<T>): Promise<T> => {
    if (deadlineAt === undefined) return call()
    // The scope's deadlines are system time (commandWaitMs reads Date.now()): what is left on this call's own clock is
    // carried over, so an injected clock and the remote commands' budget agree.
    const own = Date.now() + (deadlineAt - clock.now())
    const outer = scope.getStore()
    return withCallDeadline(outer === undefined ? own : Math.min(outer, own), call)
  }
  return { read: (port) => waited(port, false), write: (port) => waited(port, true), scoped, lost }
}

/** `work`, or undefined once the enclosing call's budget runs out first (no enclosing call: `work` as it is). */
export function withinCallBudget<T>(work: Promise<T>, now: number = Date.now()): Promise<T | undefined> {
  const deadline = scope.getStore()
  if (deadline === undefined) return work
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), Math.max(0, deadline - now))
    timer.unref?.()
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
