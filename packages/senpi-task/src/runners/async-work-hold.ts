import type { RunnerOutcome } from "./in-process/child-handle"
import {
  abandonedAsyncWorkOutcome,
  asyncWorkPendingOutcome,
  pendingWorkSignature,
  type PendingAsyncWork,
} from "./pending-async-work"

export type AsyncWorkTimerHandle = { readonly cancel: () => void }
export type AsyncWorkScheduler = (run: () => void, delayMs: number) => AsyncWorkTimerHandle

const DEFAULT_ASYNC_WORK_STALE_LIMIT_MS = 60 * 60_000
// senpi drops a finished monitor from its lifecycle at once but delivers the monitor's wake only after its
// notifier's coalescing window (default 2 s, at most 60 s), so a drained, idle session can still be woken.
export const WAKE_DELIVERY_GRACE_MS = 60_000
const DRAINED_SIGNATURE = "drained"

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
  readonly wakeDeliveryGraceMs?: number
}

export type AsyncWorkHold = {
  readonly begin: (outcome: CompletedOutcome, work: PendingAsyncWork) => void
  readonly activity: () => void
  readonly cancel: () => void
  // The turn ends now (an exit, a park, a teardown): no further confirmation runs, and `abandoned`
  // still names the work the turn left behind.
  readonly disarm: () => void
  readonly holding: () => boolean
  readonly abandoned: () => RunnerOutcome | undefined
}

type Held = {
  readonly outcome: CompletedOutcome
  work: PendingAsyncWork
}

function duration(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1_000)} s`
}

/**
 * Holds a completed turn while the child's own async work is pending (omo#10487). The held outcome is
 * an interim progress note, so it is NEVER the result: a turn the work's completion starts replaces
 * the hold (the caller cancels it and that turn's outcome is the result), and every other way the
 * hold ends is the typed `async_work_pending` failure naming the work - the work drained and the
 * session stayed idle with no new turn for the whole wake-delivery grace (consecutive drained+idle
 * confirmations; any pending work, busy read or child activity restarts it), the session state stays
 * unreadable, or the work stops progressing.
 * Every confirmation reads the session's state and the engine's pending work again. The wait is
 * bounded by progress, not by wall clock: any child activity or any change in the pending work
 * restarts it.
 */
export function createAsyncWorkHold(input: AsyncWorkHoldInput): AsyncWorkHold {
  const staleLimitMs = input.staleLimitMs ?? DEFAULT_ASYNC_WORK_STALE_LIMIT_MS
  const maxStaleChecks = Math.max(1, Math.ceil(staleLimitMs / input.intervalMs))
  const maxUnreadable = input.maxUnreadable ?? 3
  const quietChecksNeeded = Math.max(
    1,
    Math.ceil((input.wakeDeliveryGraceMs ?? WAKE_DELIVERY_GRACE_MS) / input.intervalMs),
  )
  let held: Held | undefined
  let signature = ""
  let staleChecks = 0
  let progressed = false
  let unreadable = 0
  let timer: AsyncWorkTimerHandle | undefined
  let disarmed = false
  // Consecutive drained+idle confirmations since the quiet window opened; undefined while it is closed.
  let quietChecks: number | undefined

  const disarm = (): void => {
    disarmed = true
    timer?.cancel()
    timer = undefined
  }

  const cancel = (): void => {
    held = undefined
    quietChecks = undefined
    disarm()
  }

  const fail = (current: Held, why: string): void => {
    const outcome = asyncWorkPendingOutcome(current.work, why)
    cancel()
    if (input.disposed?.() === true) return
    input.settle(outcome)
  }

  const arm = (): void => {
    if (held === undefined || timer !== undefined || disarmed) return
    timer = input.schedule(check, input.intervalMs)
  }

  // One no-progress bound for the whole unresolved hold: while the work is pending, and after it
  // drained while the session stays readable but not idle (queued input that never starts a turn).
  const stillUnresolved = (current: Held, next: PendingAsyncWork | undefined): boolean => {
    const nextSignature = next === undefined ? DRAINED_SIGNATURE : pendingWorkSignature(next)
    staleChecks = progressed || nextSignature !== signature ? 0 : staleChecks + 1
    progressed = false
    signature = nextSignature
    if (next !== undefined) current.work = next
    if (staleChecks < maxStaleChecks) return true
    fail(
      current,
      next === undefined
        ? `that work finished, but the child did not answer for ${duration(staleLimitMs)}`
        : `none of it progressed for ${duration(staleLimitMs)}`,
    )
    return false
  }

  const confirm = (current: Held, idle: boolean | undefined): void => {
    if (held !== current || disarmed || input.disposed?.() === true) return
    const next = input.pending()
    if (next === undefined && idle === true) {
      unreadable = 0
      quietChecks = quietChecks === undefined ? 0 : quietChecks + 1
      if (quietChecks < quietChecksNeeded) arm()
      else fail(current, "it finished, but nothing woke the child to answer it; resume it with task_send")
      return
    }
    quietChecks = undefined
    if (next !== undefined) {
      unreadable = 0
      if (stillUnresolved(current, next)) arm()
      return
    }
    if (idle === undefined) {
      unreadable += 1
      if (unreadable >= maxUnreadable) fail(current, "its session state could not be read after that work drained")
      else arm()
      return
    }
    unreadable = 0
    if (stillUnresolved(current, undefined)) arm()
  }

  function check(): void {
    timer = undefined
    const current = held
    if (current === undefined) return
    void Promise.resolve()
      .then(input.idle)
      .then(
        (idle) => confirm(current, idle),
        () => confirm(current, undefined),
      )
  }

  return {
    begin: (outcome, pending) => {
      cancel()
      disarmed = false
      held = { outcome, work: pending }
      signature = pendingWorkSignature(pending)
      staleChecks = 0
      progressed = false
      unreadable = 0
      arm()
    },
    activity: () => {
      if (held === undefined) return
      progressed = true
      quietChecks = undefined
    },
    cancel,
    disarm,
    holding: () => held !== undefined,
    abandoned: () => (held === undefined ? undefined : abandonedAsyncWorkOutcome(held.work)),
  }
}
