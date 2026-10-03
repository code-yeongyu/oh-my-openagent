import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import type { RunnerOutcome } from "../in-process/child-handle"
import { agentEndOutcome } from "./turn-outcome"

type AgentEndEvent = Extract<AgentSessionEvent, { readonly type: "agent_end" }>

export type TurnSettlementInput = {
  readonly settle: (outcome: RunnerOutcome) => void
  readonly abortedByUser: () => boolean
  readonly baseline: () => string | undefined
  readonly finalText: () => string | undefined
}

export type TurnSettlement = {
  readonly observe: (event: AgentSessionEvent) => void
  readonly pending: () => RunnerOutcome | undefined
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

export function createTurnSettlement(input: TurnSettlementInput): TurnSettlement {
  let held: RunnerOutcome | undefined
  const endOutcome = (event: AgentEndEvent): RunnerOutcome =>
    input.abortedByUser() ? { status: "cancelled" } : agentEndOutcome(event, input.baseline(), input.finalText())
  return {
    observe: (event) => {
      switch (event.type) {
        case "agent_start":
          held = undefined
          return
        case "agent_end": {
          if (event.willRetry !== false) return
          const outcome = endOutcome(event)
          if (outcome.status === "cancelled") {
            held = undefined
            input.settle(outcome)
            return
          }
          held = outcome
          return
        }
        case "agent_idle": {
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
  }
}
