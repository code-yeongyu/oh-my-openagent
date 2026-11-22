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

// omo#13426: the tool call's abort signal rides with its deadline, so a cancelled call leaves nothing to wait for.
type CallScope = { readonly deadline: number; readonly signal: AbortSignal | undefined }

const scope = new AsyncLocalStorage<CallScope>()

/**
 * Runs `call` with every remote command inside it bounded by `deadlineMs` (epoch ms) and, when `signal` is given, by
 * that signal: once it aborts, every wait left in the call is zero.
 */
export const withCallDeadline = <T>(deadlineMs: number, call: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
  scope.run({ deadline: deadlineMs, signal }, call)

/** What is left of the enclosing call's budget: none once its signal aborted (no enclosing call: undefined). */
function remainingMs(now: number): number | undefined {
  const current = scope.getStore()
  if (current === undefined) return undefined
  return current.signal?.aborted === true ? 0 : current.deadline - now
}

/** The wait a remote command may take: `bound`, cut to what is left of the enclosing call's deadline (none: `bound`). */
export function commandWaitMs(bound: number, now: number = Date.now()): number {
  const left = remainingMs(now)
  return left === undefined ? bound : Math.min(bound, left)
}

/** A wait inside a call: `requested`, cut so that `reserve` of the call's budget is left for what follows (none: as asked). */
export function waitWithinCallBudget(
  requested: number,
  reserve: number = READ_RESERVE_MS,
  now: number = Date.now(),
): number {
  const left = remainingMs(now)
  return left === undefined ? requested : Math.max(0, Math.min(requested, left - reserve))
}

/** Runs `work` outside any call's budget: a background task a call queued (a held re-send) outlives that call. */
export const outsideCallDeadline = <T>(work: () => T): T => scope.exit(work)

/**
 * `work`, or undefined once the enclosing call's budget runs out or its signal aborts first (no enclosing call: `work`
 * as it is).
 */
export function withinCallBudget<T>(work: Promise<T>, now: number = Date.now()): Promise<T | undefined> {
  const left = remainingMs(now)
  if (left === undefined) return work
  const signal = scope.getStore()?.signal
  return new Promise<T | undefined>((resolve, reject) => {
    const onAbort = () => settle(() => resolve(undefined))
    const timer = setTimeout(onAbort, Math.max(0, left))
    timer.unref?.()
    const settle = (done: () => void) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      done()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    work.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    )
  })
}

/**
 * `work`'s value, or undefined as soon as `signal` aborts (at once when it already has). The work itself is not stopped
 * here: its remote waits read the same signal through the call scope and end on their own; a late rejection is dropped.
 */
export function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<{ readonly value: T } | undefined> {
  work.catch(() => undefined)
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(undefined)
    signal.addEventListener("abort", onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve({ value })
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
