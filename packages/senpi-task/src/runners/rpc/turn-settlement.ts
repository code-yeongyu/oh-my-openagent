import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import { usageLimitScope } from "../../manager/credential-failure"
import type { RunnerOutcome } from "../in-process/child-handle"
import { agentEndOutcome } from "./turn-outcome"
import { retryDelayMs } from "./retry-delay"

type AgentEndEvent = Extract<AgentSessionEvent, { readonly type: "agent_end" }>

export type TurnSettlementProbe = {
  readonly isStreaming?: boolean
  readonly isCompacting?: boolean
  readonly steering?: readonly unknown[]
  readonly followUp?: readonly unknown[]
  readonly pendingMessageCount?: number
}

/** One armed settle confirmation: `cancel` disarms it. */
export type SettlementTimerHandle = { readonly cancel: () => void }

/**
 * Arms the settle confirmation. Production uses the default real (unref'd) timeout; a test drives
 * the confirmation by hand instead of waiting on a wall clock.
 */
export type TurnSettlementScheduler = (run: () => void, delayMs: number) => SettlementTimerHandle

const defaultConfirmationScheduler: TurnSettlementScheduler = (run, delayMs) => {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

export type TurnSettlementInput = {
  readonly settle: (outcome: RunnerOutcome) => void
  readonly abortedByUser: () => boolean
  readonly baseline: () => string | undefined
  readonly finalText: () => string | undefined
  // senpi#3262: how the held error is confirmed terminal when agent_idle never arrives. The probe
  // answers the session's own state; `undefined` means the state could not be read (a non-success
  // reply). The wake gate names a session-scoped lifecycle that still owns the turn (a goal
  // recovery timer, a terminal monitor). Absent: the historical behavior - the outcome waits for
  // agent_idle forever.
  readonly probe?: () => Promise<TurnSettlementProbe | undefined>
  readonly settleConfirmMs?: number
  // Unreadable probe answers re-arm the confirmation, but only this many in a row (default 3):
  // a session whose get_state never succeeds again settles the known error instead of re-arming
  // forever.
  readonly maxUnreadableProbes?: number
  readonly wakeSourcesLive?: () => boolean
  // Teardown detached/tore down the handle while a probe was in flight: that flight must never
  // report the held error as failed - the exit path owns the outcome from here (senpi#3262 review).
  readonly disposed?: () => boolean
  readonly scheduleConfirmation?: TurnSettlementScheduler
}

export type TurnSettlement = {
  readonly observe: (event: AgentSessionEvent) => void
  readonly pending: () => RunnerOutcome | undefined
  readonly cancelConfirmation: () => void
  // A wake source the handle tracks just dropped: re-offer the held error a confirmation chance.
  // No-op when nothing is held, a confirmation is already armed, or no probe was wired.
  readonly reconfirmHeld: () => void
}

/**
 * A run's `agent_end` is not the child's last word (omo#9069). The session may continue on its own
 * after it: a stream rule's corrective nudge, a goal backstop or any other settle-time continuation
 * starts a NEW run in the same session. senpi says the session is really done with `agent_idle`,
 * which it emits only when no deferred continuation started and no session work is pending; a
 * continuation announces itself with `agent_start` instead. So the outcome of a non-retrying
 * `agent_end` is held and settled on `agent_idle`, dropped when another run starts, and a user
 * abort still settles at once as cancelled.
 */
/**
 * A reopened session may still have work queued or running even when its transcript ends with a final
 * answer (a monitor wake, a queued follow-up): only a session that is idle has really finished.
 */
export function sessionIsIdle(state: {
  readonly isStreaming?: boolean
  readonly isCompacting?: boolean
  readonly steering?: readonly unknown[]
  readonly followUp?: readonly unknown[]
  readonly pendingMessageCount?: number
}): boolean {
  return (
    state.isStreaming === false &&
    state.isCompacting !== true &&
    (state.steering?.length ?? 0) === 0 &&
    (state.followUp?.length ?? 0) === 0 &&
    (state.pendingMessageCount ?? 0) === 0
  )
}

// omo#9711: a usage limit stays spent until a reset hours away, so neither a wake source nor an announced engine
// retry can make progress on it. Give an announced retry its stated backoff plus one confirmation interval
// to emit agent_start, then settle the limit even when unrelated wake sources remain live.
const isUsageLimit = (outcome: RunnerOutcome): boolean =>
  outcome.status === "error" && usageLimitScope(outcome.failure.message) !== undefined

export function createTurnSettlement(input: TurnSettlementInput): TurnSettlement {
  let held: RunnerOutcome | undefined
  let confirmation: SettlementTimerHandle | undefined
  let unreadableProbes = 0
  // A usage-limit end was already seen since the last non-limit end: a later terminal usage-limit end means a wake,
  // a steer or the engine's own retry re-hit the spent limit, so it settles at once instead of waiting again.
  let limitSeen = false
  let retryWaitMs = 0
  const scheduleConfirmation = input.scheduleConfirmation ?? defaultConfirmationScheduler
  const maxUnreadableProbes = input.maxUnreadableProbes ?? 3
  const endOutcome = (event: AgentEndEvent): RunnerOutcome =>
    agentEndOutcome(event, input.baseline(), input.finalText(), input.abortedByUser())

  // A terminal error outcome with no live continuation must still end the turn: agent_idle is the
  // preferred edge, but a session that never emits it (and never starts a continuation) would
  // otherwise leave waitForOutcome pending forever. The confirmation re-checks the session's own
  // state instead of trusting the wait: only a truly idle session with no session-scoped wake
  // settles the held error. A live wake source defers it but never drops it: the confirmation
  // re-arms until the source ends. A usage-limit error settles at once (see isUsageLimit).
  const confirmHeld = (): void => {
    confirmation = undefined
    const outcome = held
    if (outcome === undefined || outcome.status !== "error") return
    if (isUsageLimit(outcome)) {
      if (input.disposed?.() === true) return
      held = undefined
      input.settle(outcome)
      return
    }
    if (input.wakeSourcesLive?.() === true) {
      rearm()
      return
    }
    const probe = input.probe
    if (probe === undefined) return
    void Promise.resolve()
      .then(probe)
      .then((state) => {
        if (held !== outcome || input.disposed?.() === true) return
        if (input.wakeSourcesLive?.() === true) {
          rearm()
          return
        }
        if (state === undefined) {
          unreadableProbes += 1
          if (unreadableProbes >= maxUnreadableProbes) {
            held = undefined
            input.settle(outcome)
            return
          }
          rearm()
          return
        }
        unreadableProbes = 0
        if (!sessionIsIdle(state)) {
          rearm()
          return
        }
        held = undefined
        input.settle(outcome)
      })
      .catch(() => {
        // A rejected probe proves nothing about idleness; the error text is already known. But a
        // rejection caused by teardown (detach raced the flight), or one landing after a wake
        // source came live, must not turn a cancelled or still-owned turn into a failure.
        if (held !== outcome || input.disposed?.() === true) return
        if (input.wakeSourcesLive?.() === true) {
          rearm()
          return
        }
        held = undefined
        input.settle(outcome)
      })
  }

  const rearm = (): void => {
    if (held === undefined || held.status !== "error") return
    if (input.probe === undefined || input.settleConfirmMs === undefined) return
    if (confirmation !== undefined) return
    confirmation = scheduleConfirmation(confirmHeld, input.settleConfirmMs + retryWaitMs)
  }

  const clearConfirmation = (): void => {
    if (confirmation === undefined) return
    confirmation.cancel()
    confirmation = undefined
  }

  return {
    observe: (event) => {
      switch (event.type) {
        case "agent_start":
          clearConfirmation()
          held = undefined
          retryWaitMs = 0
          return
        case "auto_retry_start":
          if (held !== undefined && isUsageLimit(held)) {
            retryWaitMs = retryDelayMs(event, event.errorMessage)
            clearConfirmation()
            rearm()
          }
          return
        case "agent_end": {
          const outcome = endOutcome(event)
          const spent = isUsageLimit(outcome)
          if (event.willRetry !== false) {
            // On a spent account the engine can announce a retry it never starts (omo#9711): no agent_start and no
            // terminal end follow, so the announced end is held like a terminal one and the bound settles it.
            if (!spent) return
            held = outcome
            limitSeen = true
            retryWaitMs = retryDelayMs(event, outcome.status === "error" ? outcome.failure.message : "")
            clearConfirmation()
            rearm()
            return
          }
          // A replaced session runs nothing more for this child: its interrupt is final at once.
          if (outcome.status === "cancelled" || outcome.status === "interrupted") {
            clearConfirmation()
            held = undefined
            input.settle(outcome)
            return
          }
          if (spent && limitSeen) {
            clearConfirmation()
            held = undefined
            input.settle(outcome)
            return
          }
          limitSeen = spent
          retryWaitMs = 0
          held = outcome
          unreadableProbes = 0
          if (outcome.status === "error") rearm()
          return
        }
        case "agent_idle": {
          clearConfirmation()
          const outcome = held
          held = undefined
          if (outcome !== undefined) input.settle(outcome)
          return
        }
        default:
          return
      }
    },
    pending: () => held,
    cancelConfirmation: clearConfirmation,
    reconfirmHeld: rearm,
  }
}
