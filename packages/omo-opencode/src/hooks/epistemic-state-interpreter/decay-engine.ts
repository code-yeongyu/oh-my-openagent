import type { EpistemicState } from "./types"

const DECAY_CHAIN: EpistemicState[] = [
  "accepted",
  "plausible",
  "open",
  "operationally_excluded",
  "excluded",
]
// "inconclusive" is resolved after classification and should decay along the open -> operationally_excluded -> excluded path instead.

export interface DecayInput {
  currentState: EpistemicState
  lastSeenInvocation: number
  currentInvocation: number
  decayThreshold: number
}

export interface DecayOutput {
  newState: EpistemicState
  decayed: boolean
}

export function computeDecay(input: DecayInput): DecayOutput {
  const { currentState, lastSeenInvocation, currentInvocation, decayThreshold } =
    input
  const effectiveCurrentState = currentState === "inconclusive" ? "open" : currentState

  if (effectiveCurrentState === "excluded") {
    return { newState: "excluded", decayed: false }
  }

  const absentFor = currentInvocation - lastSeenInvocation
  if (absentFor < decayThreshold) {
    return { newState: effectiveCurrentState, decayed: false }
  }

  const currentIndex = DECAY_CHAIN.indexOf(effectiveCurrentState)
  if (currentIndex === -1) {
    return { newState: effectiveCurrentState, decayed: false }
  }

  const nextIndex = currentIndex + 1
  if (nextIndex >= DECAY_CHAIN.length) {
    return { newState: effectiveCurrentState, decayed: false }
  }

  return { newState: DECAY_CHAIN[nextIndex], decayed: true }
}
