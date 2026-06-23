import type { CertaintyLevel } from "../consequence-lifting-sidecar/certainty-types"
import type { SidecarOutput } from "../consequence-lifting-sidecar"

export interface ConfidenceScores {
  framework_certainty: number
  world_certainty: number
}

const CERTAINTY_SCORE_MAP: Record<CertaintyLevel, number> = {
  high: 0.85,
  medium: 0.55,
  low: 0.25,
}

export function mapCertaintyToScore(level: CertaintyLevel | null | undefined): number {
  if (!level) return 0
  return CERTAINTY_SCORE_MAP[level]
}

export function extractConfidenceFromSidecar(sidecarResult: SidecarOutput | null): ConfidenceScores | null {
  if (!sidecarResult) return null

  const selectedDecisions = Object.values(sidecarResult.bundle?.selection?.selectedBySlot ?? {}).flat()
  const selectedDecision = selectedDecisions[0]
  if (!selectedDecision) return null

  const profile = sidecarResult.profiles.find((p) => p.decision === selectedDecision)
  if (!profile) return null

  return {
    framework_certainty: mapCertaintyToScore(profile.framework_certainty),
    world_certainty: mapCertaintyToScore(profile.world_certainty),
  }
}
