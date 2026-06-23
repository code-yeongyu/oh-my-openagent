import type { DominanceResult } from "./v5-types"
import type { EpistemicAnnotation } from "./types"

const SELF_SUFFICIENT_BONUS = 0.05
const TRIVIAL_DOMINANCE_MARGIN = 1
const SCORE_PRECISION = 10

function getDominanceScore(annotation: EpistemicAnnotation): number {
  const confidenceScore = annotation.confidence?.value ?? 0
  const selfSufficientBonus = annotation.dependency?.selfSufficient === true ? SELF_SUFFICIENT_BONUS : 0

  return confidenceScore + selfSufficientBonus
}

function normalizeScore(value: number): number {
  return Number(value.toFixed(SCORE_PRECISION))
}

export function rankDominance(
  annotations: EpistemicAnnotation[],
  dominanceThreshold: number,
): DominanceResult {
  if (annotations.length === 0) {
    return {
      ranking: [],
      dominant: null,
      margin: 0,
      isConclusive: false,
    }
  }

  const ranking = annotations
    .map((annotation) => ({
      conclusion: annotation.conclusion,
      score: normalizeScore(getDominanceScore(annotation)),
    }))
    .sort((left, right) => right.score - left.score)

  if (ranking.length === 1) {
    return {
      ranking,
      dominant: ranking[0]?.conclusion ?? null,
      margin: TRIVIAL_DOMINANCE_MARGIN,
      isConclusive: true,
    }
  }

  const margin = normalizeScore(ranking[0].score - ranking[1].score)
  const isConclusive = margin >= dominanceThreshold

  return {
    ranking,
    dominant: isConclusive ? ranking[0].conclusion : null,
    margin,
    isConclusive,
  }
}
