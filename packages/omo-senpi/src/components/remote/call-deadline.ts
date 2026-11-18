import { AsyncLocalStorage } from "node:async_hooks"

// omo#14130: one thread tool call may send several commands to another device (a send's state probe, its admission and
// the state read after it; a read's pages). Each sizes its wait to what is left of the call's budget, so the whole call
// settles, typed, inside the 60 s a host-tool bridge (the eval kernel's) gives a tool call before dropping it untyped.
export const TOOL_CALL_BUDGET_MS = 50_000

const scope = new AsyncLocalStorage<number>()

/** Runs `call` with every remote command inside it bounded by `deadlineMs` (epoch ms). */
export const withCallDeadline = <T>(deadlineMs: number, call: () => Promise<T>): Promise<T> =>
  scope.run(deadlineMs, call)

/** The wait a remote command may take: `bound`, cut to what is left of the enclosing call's deadline (none: `bound`). */
export function commandWaitMs(bound: number, now: number = Date.now()): number {
  const deadline = scope.getStore()
  return deadline === undefined ? bound : Math.min(bound, deadline - now)
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
