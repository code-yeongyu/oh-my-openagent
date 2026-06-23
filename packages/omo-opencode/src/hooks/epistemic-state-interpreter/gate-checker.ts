import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import type { EpistemicState } from "./types"

export interface GateResult {
  allowed: boolean
  reason: string
}

const STATE_ORDER: EpistemicState[] = [
  "excluded",
  "operationally_excluded",
  "open",
  "plausible",
  "accepted",
]

function isFailClosedState(state: EpistemicState): boolean {
  return state === "inconclusive"
}

function isDominanceBlockedState(state: EpistemicState): boolean {
  return state === "excluded" || state === "operationally_excluded" || state === "inconclusive"
}

function stateRank(state: EpistemicState): number {
  return STATE_ORDER.indexOf(state)
}

export function checkGate(
  state: EpistemicState,
  mode: EpistemicGateMode,
  conclusion: string
): GateResult {
  if (mode === "annotation") {
    return { allowed: true, reason: "annotation mode: gate disabled" }
  }

  if (mode === "gate") {
    if (isFailClosedState(state)) {
      return {
        allowed: false,
        reason: `gate mode: conclusion '${conclusion}' blocked (state=${state}, fail-closed)`,
      }
    }

    const rank = stateRank(state)
    const openRank = stateRank("open")
    if (rank < openRank) {
      return {
        allowed: false,
        reason: `gate mode: conclusion '${conclusion}' blocked (state=${state}, below 'open')`,
      }
    }
    return { allowed: true, reason: `gate mode: state ${state} >= open` }
  }

  if (mode === "dominance") {
    if (isDominanceBlockedState(state)) {
      return {
        allowed: false,
        reason: `dominance mode: conclusion '${conclusion}' blocked (state=${state})`,
      }
    }

    return { allowed: true, reason: `dominance mode: state ${state} allowed` }
  }

  // hybrid mode: block only excluded + operationally_excluded
  if (state === "excluded" || state === "operationally_excluded") {
    return {
      allowed: false,
      reason: `hybrid mode: conclusion '${conclusion}' blocked (state=${state})`,
    }
  }

  if (isFailClosedState(state)) {
    return {
      allowed: false,
      reason: `hybrid mode: conclusion '${conclusion}' blocked (state=${state}, fail-closed)`,
    }
  }

  return { allowed: true, reason: `hybrid mode: state ${state} allowed` }
}
