import type { RunnerOutcome } from "./in-process/child-handle"
import { asyncWorkPendingOutcome, pendingWorkSignature, type PendingAsyncWork } from "./pending-async-work"

export type AsyncWorkTimerHandle = { readonly cancel: () => void }
export type AsyncWorkScheduler = (run: () => void, delayMs: number) => AsyncWorkTimerHandle

export const DEFAULT_ASYNC_WORK_STALE_LIMIT_MS = 60 * 60_000

type CompletedOutcome = Extract<RunnerOutcome, { readonly status: "completed" }>

export type AsyncWorkHoldInput = {
  readonly pending: () => PendingAsyncWork | undefined
  /** `undefined`: the session state could not be read. A rejection reads the same. */
  readonly idle: () => Promise<boolean | undefined>
  readonly settle: (outcome: RunnerOutcome) => void
  readonly schedule: AsyncWorkScheduler
  readonly intervalMs: number
  readonly staleLimitMs?: number
  readonly maxUnreadable?: number
  readonly disposed?: () => boolean
  // What a held turn amounts to once its work drained and the session idles with no turn started:
  // by default the held completion. A runner whose engine delivers no completion notification
  // answers with the typed failure instead, since nothing will ever wake that child to answer.
  readonly drained?: (held: CompletedOutcome, work: PendingAsyncWork) => RunnerOutcome
}

export type AsyncWorkHold = {
  readonly begin: (outcome: CompletedOutcome, work: PendingAsyncWork) => void
  readonly activity: () => void
  readonly cancel: () => void
  readonly holding: () => boolean
  readonly abandoned: () => RunnerOutcome | undefined
}

function duration(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1_000)} s`
}

/**
 * Holds a completed turn while the child's own async work is pending (omo#10487). Every
 * confirmation reads the session's state and the engine's pending work again: once the work is
 * gone and the session is idle the held completion settles; if the work's completion wakes the
 * child into a new turn, the caller cancels the hold and that turn's outcome is the result. The
 * wait is bounded by progress, not by wall clock: any child activity or any change in the pending
 * work restarts it, and only work that stays exactly as it was for `staleLimitMs` settles as the
 * typed `async_work_pending` failure.
 */
export function createAsyncWorkHold(input: AsyncWorkHoldInput): AsyncWorkHold {
  const staleLimitMs = input.staleLimitMs ?? DEFAULT_ASYNC_WORK_STALE_LIMIT_MS
  const maxStaleChecks = Math.max(1, Math.ceil(staleLimitMs / input.intervalMs))
  const maxUnreadable = input.maxUnreadable ?? 3
  let held: CompletedOutcome | undefined
  let work: PendingAsyncWork | undefined
  let signature = ""
  let staleChecks = 0
  let progressed = false
  let unreadable = 0
  let timer: AsyncWorkTimerHandle | undefined

  const cancel = (): void => {
    held = undefined
    work = undefined
    timer?.cancel()
    timer = undefined
  }

  const finish = (outcome: RunnerOutcome): void => {
    cancel()
    if (input.disposed?.() === true) return
    input.settle(outcome)
  }

  const arm = (): void => {
    if (held === undefined || timer !== undefined) return
    timer = input.schedule(check, input.intervalMs)
  }

  const stillPending = (next: PendingAsyncWork): boolean => {
    const nextSignature = pendingWorkSignature(next)
    staleChecks = progressed || nextSignature !== signature ? 0 : staleChecks + 1
    progressed = false
    signature = nextSignature
    work = next
    if (staleChecks < maxStaleChecks) return true
    finish(asyncWorkPendingOutcome(next, `none of it progressed for ${duration(staleLimitMs)}`))
    return false
  }

  const confirm = (outcome: CompletedOutcome, idle: boolean | undefined): void => {
    if (held !== outcome || input.disposed?.() === true) return
    const next = input.pending()
    if (next !== undefined) {
      unreadable = 0
      if (stillPending(next)) arm()
      return
    }
    if (idle === undefined) {
      unreadable += 1
      if (unreadable >= maxUnreadable) finish(outcome)
      else arm()
      return
    }
    unreadable = 0
    if (!idle) arm()
    else finish(work === undefined || input.drained === undefined ? outcome : input.drained(outcome, work))
  }

  function check(): void {
    timer = undefined
    const outcome = held
    if (outcome === undefined) return
    void Promise.resolve()
      .then(input.idle)
      .then(
        (idle) => confirm(outcome, idle),
        () => confirm(outcome, undefined),
      )
  }

  return {
    begin: (outcome, pending) => {
      cancel()
      held = outcome
      work = pending
      signature = pendingWorkSignature(pending)
      staleChecks = 0
      progressed = false
      unreadable = 0
      arm()
    },
    activity: () => {
      if (held !== undefined) progressed = true
    },
    cancel,
    holding: () => held !== undefined,
    abandoned: () =>
      held === undefined || work === undefined
        ? undefined
        : asyncWorkPendingOutcome(work, "the child stopped before that work settled"),
  }
}
