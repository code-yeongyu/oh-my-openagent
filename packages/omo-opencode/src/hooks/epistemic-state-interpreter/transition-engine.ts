import type { EpistemicState } from "./types"
import type { HistoryEntry, TransitionRecord } from "./transition-types"
import { getApplicableTransition } from "./transition-table"
import type { TransitionDefinition } from "./transition-table"

export interface TransitionInput {
  currentState: EpistemicState
  newClassification: EpistemicState
  consecutiveCount: number
  history: HistoryEntry[]
}

export interface TransitionOutput {
  newState: EpistemicState
  transition: TransitionRecord | null
}

export function computeTransition(input: TransitionInput, table?: TransitionDefinition[]): TransitionOutput {
  const { currentState, newClassification, consecutiveCount } = input
  const effectiveCurrentState = currentState === "inconclusive" ? "open" : currentState

  if (newClassification === "inconclusive") {
    return { newState: currentState, transition: null }
  }

  if (effectiveCurrentState === "excluded") {
    return { newState: "excluded", transition: null }
  }

  if (input.history.length === 0) {
    return { newState: newClassification, transition: null }
  }

  const definition = getApplicableTransition(effectiveCurrentState, newClassification, table)

  if (!definition) {
    return { newState: effectiveCurrentState, transition: null }
  }

  if (consecutiveCount < definition.thresholdValue) {
    return { newState: effectiveCurrentState, transition: null }
  }

  const transition: TransitionRecord = {
    id: definition.id,
    from: effectiveCurrentState,
    to: definition.to,
    conclusion: "",
    timestamp: Date.now(),
    reason: `consecutiveCount=${consecutiveCount} >= threshold=${definition.thresholdValue}`,
  }

  return { newState: definition.to, transition }
}
