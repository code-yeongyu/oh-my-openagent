import { createAsyncWorkHold, type AsyncWorkScheduler } from "../async-work-hold"
import { readLifecyclePendingWork } from "../pending-async-work"
import type { ChildSessionEvent, ChildSessionListener, RunnerOutcome } from "./child-handle"

export type InProcessAsyncWorkOptions = {
  readonly schedule?: AsyncWorkScheduler
  readonly intervalMs?: number
  readonly staleLimitMs?: number
}

export type AsyncWorkSession = {
  readonly lifecycle?: unknown
  readonly isSessionBusy?: boolean
  subscribe(listener: ChildSessionListener): () => void
}

export type InProcessAsyncWork = {
  readonly settle: (outcome: RunnerOutcome) => Promise<RunnerOutcome>
  readonly supersede: (next: Promise<RunnerOutcome>) => void
  readonly abandon: () => void
  readonly abort: () => void
}

type Release = (value: RunnerOutcome | Promise<RunnerOutcome> | "abandoned") => void

const DEFAULT_INTERVAL_MS = 2_000

const defaultSchedule: AsyncWorkScheduler = (run, delayMs) => {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

function endsTurn(event: ChildSessionEvent): boolean {
  return event.type === "agent_end" && (event as { readonly willRetry?: unknown }).willRetry !== true
}

/**
 * The in-process runner's half of omo#10487. `session.prompt()` resolves when the turn ends, but a
 * child that detached an eval cell or started a background job has not answered yet: the engine's
 * lifecycle still reports that work, and its completion starts a new engine turn in the same session.
 * A completed outcome is therefore held while `session.lifecycle` reports pending work; the engine
 * turn the work starts is observed from its `agent_start` to its `agent_end`, and that turn's outcome
 * (held again if it, too, left work behind) is the child's result.
 */
export function createInProcessAsyncWork(input: {
  readonly session: AsyncWorkSession
  readonly options?: InProcessAsyncWorkOptions
  readonly engineTurnStarted: () => void
  readonly engineTurnOutcome: () => RunnerOutcome
}): InProcessAsyncWork {
  const { session } = input
  let release: Release | undefined

  const settle = (outcome: RunnerOutcome): Promise<RunnerOutcome> => {
    if (outcome.status !== "completed") return Promise.resolve(outcome)
    const work = readLifecyclePendingWork(session.lifecycle)
    if (work === null || work === undefined) return Promise.resolve(outcome)
    return new Promise<RunnerOutcome>((resolve) => {
      let engineTurn = false
      const hold = createAsyncWorkHold({
        pending: () => readLifecyclePendingWork(session.lifecycle) ?? undefined,
        idle: () => Promise.resolve(session.isSessionBusy !== true),
        settle: (settled) => own(settled),
        schedule: input.options?.schedule ?? defaultSchedule,
        intervalMs: input.options?.intervalMs ?? DEFAULT_INTERVAL_MS,
        staleLimitMs: input.options?.staleLimitMs,
      })
      // While this release is installed the hold still holds (begin runs first; a wake turn only
      // disarms it), so an abandon always answers the abandoned work, never the held note.
      const own: Release = (value) => {
        if (release !== own) return
        release = undefined
        const abandoned = hold.abandoned() ?? { status: "cancelled" }
        hold.cancel()
        unsubscribe()
        resolve(value === "abandoned" ? abandoned : value)
      }
      const unsubscribe = session.subscribe((event) => {
        hold.activity()
        if (event.type === "agent_start" && !engineTurn) {
          engineTurn = true
          // The work's wake turn answers now: stop confirming, but keep the work it answers for
          // until that turn ends, so a teardown meanwhile is still the abandoned work (omo#10487).
          hold.disarm()
          input.engineTurnStarted()
        } else if (engineTurn && endsTurn(event)) {
          const next = input.engineTurnOutcome()
          own(Promise.resolve().then(() => settle(next)))
        }
      })
      release?.("abandoned")
      hold.begin(outcome, work)
      release = own
    })
  }

  return {
    settle,
    supersede: (next) => release?.(next),
    abandon: () => release?.("abandoned"),
    abort: () => release?.({ status: "cancelled" }),
  }
}
