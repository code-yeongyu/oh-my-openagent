import type { EpistemicState } from "./types"
import type { TransitionID } from "./transition-types"
import type { ResolvedThresholds } from "./threshold-provider"

export const THRESHOLDS = {
  N: 3,
  M: 5,
  K: 10,
} as const

export interface TransitionDefinition {
  id: TransitionID
  from: EpistemicState
  to: EpistemicState
  direction: "ascend" | "descend" | "terminal"
  thresholdValue: number
}

export function buildTransitionTable(thresholds: ResolvedThresholds): TransitionDefinition[] {
  return [
    { id: "T1", from: "open", to: "plausible", direction: "ascend", thresholdValue: thresholds.N },
    { id: "T2", from: "plausible", to: "accepted", direction: "ascend", thresholdValue: thresholds.N },
    { id: "T3", from: "operationally_excluded", to: "open", direction: "ascend", thresholdValue: thresholds.N },
    { id: "T4", from: "accepted", to: "plausible", direction: "descend", thresholdValue: thresholds.N },
    { id: "T5", from: "plausible", to: "open", direction: "descend", thresholdValue: thresholds.N },
    { id: "T6", from: "open", to: "operationally_excluded", direction: "descend", thresholdValue: thresholds.N },
    { id: "T7", from: "accepted", to: "open", direction: "descend", thresholdValue: thresholds.M },
    { id: "T8", from: "plausible", to: "operationally_excluded", direction: "descend", thresholdValue: thresholds.M },
    { id: "T9", from: "accepted", to: "operationally_excluded", direction: "descend", thresholdValue: thresholds.M },
    { id: "T10", from: "open", to: "excluded", direction: "descend", thresholdValue: thresholds.K },
    { id: "T11", from: "operationally_excluded", to: "excluded", direction: "descend", thresholdValue: thresholds.K },
    { id: "T12", from: "excluded", to: "excluded", direction: "terminal", thresholdValue: 1 },
    { id: "T13", from: "excluded", to: "open", direction: "ascend", thresholdValue: 1 },
  ]
}

export const TRANSITION_TABLE: TransitionDefinition[] = buildTransitionTable({ N: THRESHOLDS.N, M: THRESHOLDS.M, K: THRESHOLDS.K, T: 50 })

export function getApplicableTransition(from: EpistemicState, to: EpistemicState, table?: TransitionDefinition[]): TransitionDefinition | undefined {
  return (table ?? TRANSITION_TABLE).find((transition) => transition.from === from && transition.to === to)
}

export function isValidTransition(from: EpistemicState, to: EpistemicState, table?: TransitionDefinition[]): boolean {
  return (table ?? TRANSITION_TABLE).some((transition) => transition.from === from && transition.to === to)
}
