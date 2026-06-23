import type { DecisionProfile } from "./types"
import type { RecourseLevel, VOIResult } from "./voi-types"

const CERTAINTY_SCORE = { high: 1, medium: 0.5, low: 0.2 }
const RECOURSE_WEIGHT: Record<RecourseLevel, number> = {
  reversible: 0.2,
  partially_reversible: 0.5,
  irreversible: 1,
}

function certaintyGap(profile: DecisionProfile): number {
  const world = profile.world_certainty ? CERTAINTY_SCORE[profile.world_certainty] : 0
  const framework = profile.framework_certainty ? CERTAINTY_SCORE[profile.framework_certainty] : 0
  return 1 - ((world + framework) / 2)
}

export function estimateVOI(profile: DecisionProfile, margin: number, recourseLevel: RecourseLevel): VOIResult {
  const boundedMargin = Math.max(0, Math.min(1, margin))
  const score = Number((certaintyGap(profile) * (1 - boundedMargin) * RECOURSE_WEIGHT[recourseLevel]).toFixed(3))
  const reasons: string[] = []
  if (score > 0.5) reasons.push("high_information_value_before_commitment")
  if (boundedMargin < 0.25) reasons.push("selection_margin_is_narrow")
  if (recourseLevel === "irreversible") reasons.push("decision_has_low_recourse")
  return { score, deferRecommended: score > 0.5, recourseLevel, reasons }
}
