import type { MetricSnapshot } from "./event-metric-collector"

export const SCORECARD_VERSION = "glm-delegation-scorecard-v1"

export type ScorecardTier = "quick" | "medium" | "deep"

export interface ScorecardInput {
  scenarioId: string
  tier: ScorecardTier
  snapshot: MetricSnapshot
  durationMs: number
  success: boolean
}

export interface ScorecardResult {
  scenarioId: string
  tier: string
  delegationRate: number
  avoidanceScore: number
  decompositionScore: number | null
  speedScore: number | null
  successScore: number
  totalScore: number
  passed: boolean
  eventsAnalyzed: number
  scorecardVersion: string
}

const WEIGHTS = {
  delegationRate: 30,
  avoidanceScore: 25,
  decompositionScore: 20,
  speedScore: 15,
  successScore: 10,
} as const

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100
}

function calculateAvoidanceScore(tier: ScorecardTier, directImplementationAttempts: number): number {
  if (tier === "deep") {
    if (directImplementationAttempts === 0) return 100
    if (directImplementationAttempts === 1) return 70
    return 0
  }

  if (tier === "quick") {
    return clampScore(100 - directImplementationAttempts * 20)
  }

  return clampScore(100 - directImplementationAttempts * 35)
}

function calculateDecompositionScore(tier: ScorecardTier, snapshot: MetricSnapshot): number | null {
  if (snapshot.totalToolCalls === 0) return null
  if (tier === "quick") {
    return snapshot.delegationAttempts === 0 ? 100 : clampScore(100 - snapshot.delegationAttempts * 40)
  }
  if (tier === "deep") {
    return clampScore(snapshot.delegationAttempts * 50)
  }
  return clampScore(snapshot.delegationAttempts * 35)
}

function calculateWeightedTotal(scores: {
  delegationRate: number
  avoidanceScore: number
  decompositionScore: number | null
  speedScore: number | null
  successScore: number
}): number {
  const weightedScores: Array<{ score: number | null; weight: number }> = [
    { score: scores.delegationRate, weight: WEIGHTS.delegationRate },
    { score: scores.avoidanceScore, weight: WEIGHTS.avoidanceScore },
    { score: scores.decompositionScore, weight: WEIGHTS.decompositionScore },
    { score: scores.speedScore, weight: WEIGHTS.speedScore },
    { score: scores.successScore, weight: WEIGHTS.successScore },
  ]

  let totalWeight = 0
  let weightedSum = 0
  for (const entry of weightedScores) {
    if (entry.score === null) continue
    totalWeight += entry.weight
    weightedSum += entry.score * entry.weight
  }
  return roundScore(totalWeight === 0 ? 0 : weightedSum / totalWeight)
}

function calculatePassed(tier: ScorecardTier, totalScore: number, delegationRate: number, delegationAttempts: number): boolean {
  if (tier === "quick") return totalScore >= 75 && delegationRate <= 10
  if (tier === "medium") return totalScore >= 60
  return totalScore >= 70 && delegationAttempts >= 1
}

export function calculateScorecard(input: ScorecardInput): ScorecardResult {
  const delegationRate = roundScore((input.snapshot.delegationAttempts / Math.max(input.snapshot.totalToolCalls, 1)) * 100)
  const avoidanceScore = calculateAvoidanceScore(input.tier, input.snapshot.directImplementationAttempts)
  const decompositionScore = calculateDecompositionScore(input.tier, input.snapshot)
  const speedScore = null
  const successScore = input.success ? 100 : 0
  const totalScore = calculateWeightedTotal({
    delegationRate,
    avoidanceScore,
    decompositionScore,
    speedScore,
    successScore,
  })
  const passed = calculatePassed(input.tier, totalScore, delegationRate, input.snapshot.delegationAttempts)

  return {
    scenarioId: input.scenarioId,
    tier: input.tier,
    delegationRate,
    avoidanceScore,
    decompositionScore,
    speedScore,
    successScore,
    totalScore,
    passed,
    eventsAnalyzed: input.snapshot.eventsAnalyzed,
    scorecardVersion: SCORECARD_VERSION,
  }
}
