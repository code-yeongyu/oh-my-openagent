import type { EpistemicState } from "./types"
import type {
  ConfidenceScore,
  DependencyInfo,
  DominanceResult,
  InconclusiveReason,
} from "./v5-types"

export interface ResolvedState {
  state: EpistemicState | "inconclusive"
  inconclusiveReason?: InconclusiveReason
}

export interface InconclusiveThresholds {
  confidence_min: number
  dominance_margin_min: number
}

function createInconclusiveState(reason: InconclusiveReason): ResolvedState {
  return {
    state: "inconclusive",
    inconclusiveReason: reason,
  }
}

export function resolveState(
  currentState: EpistemicState,
  confidence: ConfidenceScore | undefined,
  dependency: DependencyInfo | undefined,
  dominance: DominanceResult | undefined,
  thresholds: InconclusiveThresholds,
): ResolvedState {
  if (dependency?.hasCircularDependency) {
    return createInconclusiveState("circular_dependency")
  }

  if (confidence?.value !== null && confidence?.value !== undefined) {
    if (confidence.value < thresholds.confidence_min) {
      return createInconclusiveState("low_confidence")
    }
  }

  if (dominance?.margin !== undefined && dominance.margin < thresholds.dominance_margin_min) {
    return createInconclusiveState("narrow_margin")
  }

  return { state: currentState }
}
