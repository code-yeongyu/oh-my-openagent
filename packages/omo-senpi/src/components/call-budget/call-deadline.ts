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
