/**
 * MetaGovernor Scoring Engine — PR 5 of 8.
 *
 * The core decision engine. Takes a DecisionContext (built from signals
 * gathered by the memory-aggregator, token-predictor, and hooks) and
 * produces a Decision via weighted evidence scoring.
 *
 * Architecture invariants:
 * - Pure function: no side effects, no I/O, no MCP calls
 * - Deterministic: same input → same output (no randomness)
 * - All thresholds configurable via ScoringConfig
 * - Paralysis prevention: N consecutive stops → force continue with warning
 * - Cite-or-abstain: evidence required when action !== "continue" silently
 *
 * Score ranges (default thresholds):
 *   >= +0.3  → continue silently
 *   [-0.3, +0.3] → continue with log
 *   [-0.6, -0.3] → warn
 *   [-0.8, -0.6] → escalate
 *   < -0.8   → stop
 */

import type {
  DecisionContext,
  Decision,
  Evidence,
  EvidenceContribution,
  ScoringConfig,
  ScoringResult,
  RelevantLesson,
} from "./types"

// ─── Default weights ───────────────────────────────────────────────

/** Default weights for each evidence source (must sum to ~1.0). */
const DEFAULT_WEIGHTS: Record<string, number> = {
  "oracle-verified": 0.25,
  "no-progress-detector": 0.20,
  "deviation-detector": 0.20,
  "iteration-budget": 0.15,
  "lesson-recall": 0.10,
  "token-predictor": 0.10,
}

// ─── Default config ────────────────────────────────────────────────

export const defaultScoringConfig = (): ScoringConfig => ({
  continueThreshold: 0.3,
  warnThreshold: 0.3,
  escalateThreshold: 0.6,
  stopThreshold: 0.8,
  paralysisThreshold: 3,
  defaultEscalationTarget: "oracle",
})

// ─── Signal scoring ────────────────────────────────────────────────

/**
 * Score each signal source independently. Returns raw scores in [-1, +1].
 * Each score represents how POSITIVE (or negative) that signal is.
 */
function scoreSignals(ctx: DecisionContext): EvidenceContribution[] {
  const contributions: EvidenceContribution[] = []

  // 1. Oracle verified: +0.6 (strongly positive)
  contributions.push({
    source: "oracle-verified",
    rawScore: ctx.oracleVerified ? 0.6 : 0,
    weight: DEFAULT_WEIGHTS["oracle-verified"],
    weightedScore: ctx.oracleVerified ? 0.6 * DEFAULT_WEIGHTS["oracle-verified"] : 0,
    description: ctx.oracleVerified
      ? "Oracle verification passed"
      : "No Oracle verification",
  })

  // 2. No progress: -0.8 (strongly negative)
  contributions.push({
    source: "no-progress-detector",
    rawScore: ctx.noProgress ? -0.8 : 0,
    weight: DEFAULT_WEIGHTS["no-progress-detector"],
    weightedScore: ctx.noProgress ? -0.8 * DEFAULT_WEIGHTS["no-progress-detector"] : 0,
    description: ctx.noProgress
      ? "No progress detected in last turn"
      : "Progress detected",
  })

  // 3. Deviations: severity-weighted
  const deviationScore = scoreDeviations(ctx.deviations)
  contributions.push({
    source: "deviation-detector",
    rawScore: deviationScore,
    weight: DEFAULT_WEIGHTS["deviation-detector"],
    weightedScore: deviationScore * DEFAULT_WEIGHTS["deviation-detector"],
    description: ctx.deviations.length > 0
      ? `${ctx.deviations.length} deviation(s) detected (worst: ${ctx.deviations[0]!.severity})`
      : "No deviations detected",
  })

  // 4. Iteration budget: approaching limit → negative
  const iterationScore = scoreIterationBudget(ctx.iterationRatio)
  contributions.push({
    source: "iteration-budget",
    rawScore: iterationScore,
    weight: DEFAULT_WEIGHTS["iteration-budget"],
    weightedScore: iterationScore * DEFAULT_WEIGHTS["iteration-budget"],
    description: `Iteration ratio: ${ctx.iterationRatio.toFixed(2)} (${ctx.ambient.iteration}/${ctx.ambient.maxIterations})`,
  })

  // 5. Lessons: advice-weighted
  const lessonScore = scoreLessons(ctx.lessonsRelevant)
  contributions.push({
    source: "lesson-recall",
    rawScore: lessonScore,
    weight: DEFAULT_WEIGHTS["lesson-recall"],
    weightedScore: lessonScore * DEFAULT_WEIGHTS["lesson-recall"],
    description: ctx.lessonsRelevant.length > 0
      ? `${ctx.lessonsRelevant.length} relevant lesson(s) (avg confidence: ${avgConfidence(ctx.lessonsRelevant).toFixed(2)})`
      : "No relevant lessons",
  })

  return contributions
}

function scoreDeviations(deviations: readonly { severity: string }[]): number {
  if (deviations.length === 0) return 0

  // Score based on worst deviation severity
  const severityMap: Record<string, number> = {
    grave: -0.9,
    media: -0.5,
    leve: -0.2,
  }

  let worst = 0
  for (const d of deviations) {
    const s = severityMap[d.severity] ?? -0.3
    if (s < worst) worst = s
  }

  // Multiple deviations amplify slightly (capped at -1)
  const amplification = Math.min(deviations.length * 0.05, 0.2)
  return Math.max(worst - amplification, -1)
}

function scoreIterationBudget(ratio: number): number {
  // Linear ramp: 0.0 → 0.0, 0.5 → -0.3, 1.0 → -0.8
  if (ratio <= 0.5) return -ratio * 0.6
  return -0.3 - (ratio - 0.5) * 1.0
}

function scoreLessons(lessons: readonly RelevantLesson[]): number {
  if (lessons.length === 0) return 0

  let totalScore = 0
  for (const lesson of lessons) {
    const adviceScore: Record<string, number> = {
      continue: 0.3,
      info: 0.0,
      warn: -0.3,
      stop: -0.7,
    }
    totalScore += (adviceScore[lesson.advice] ?? 0) * lesson.confidence
  }

  // Average and clamp
  return Math.max(Math.min(totalScore / lessons.length, 1), -1)
}

function avgConfidence(lessons: readonly RelevantLesson[]): number {
  if (lessons.length === 0) return 0
  return lessons.reduce((sum, l) => sum + l.confidence, 0) / lessons.length
}

// ─── Action mapping ────────────────────────────────────────────────

function mapScoreToAction(
  score: number,
  config: ScoringConfig,
): Decision["action"] {
  if (score >= config.continueThreshold) return "continue"
  if (score <= -config.stopThreshold) return "stop"
  if (score <= -config.escalateThreshold) return "escalate"
  if (score <= -config.warnThreshold) return "warn"
  return "continue"
}

function selectEscalationTarget(
  ctx: DecisionContext,
  config: ScoringConfig,
): "oracle" | "user" | null {
  // Oracle first if it hasn't been consulted yet in this cycle
  if (!ctx.oracleVerified) return "oracle"
  // If oracle already verified and we still have issues, escalate to user
  if (ctx.deviations.some((d) => d.severity === "grave")) return "user"
  return config.defaultEscalationTarget
}

function buildReasoning(
  score: number,
  action: Decision["action"],
  contributions: EvidenceContribution[],
  paralysisOverride: boolean,
): string {
  if (paralysisOverride) {
    return `Paralysis detected: forced continue despite score ${score.toFixed(3)} (too many consecutive stops)`
  }

  // Find the strongest positive and negative contributions
  const sorted = [...contributions].sort((a, b) => a.weightedScore - b.weightedScore)
  const worst = sorted[0]!
  const best = sorted[sorted.length - 1]!

  const parts: string[] = []
  if (worst.weightedScore < 0) {
    parts.push(`primary concern: ${worst.description}`)
  }
  if (best.weightedScore > 0) {
    parts.push(`positive signal: ${best.description}`)
  }

  const actionLabel: Record<string, string> = {
    continue: "Continue",
    warn: "Warn",
    escalate: "Escalate",
    stop: "Stop",
  }

  return `${actionLabel[action]} (score: ${score.toFixed(3)}): ${parts.join("; ") || "balanced signals"}`
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Core scoring function. Pure, deterministic, no side effects.
 *
 * @param ctx - DecisionContext assembled from all signal sources
 * @param config - Scoring thresholds (defaults if omitted)
 * @returns ScoringResult with Decision, evidence breakdown, and metadata
 */
export function score(
  ctx: DecisionContext,
  config?: Partial<ScoringConfig>,
): ScoringResult {
  const resolvedConfig = { ...defaultScoringConfig(), ...config }

  // 1. Compute per-signal contributions
  const contributions = scoreSignals(ctx)

  // 2. Sum weighted scores → raw score in [-1, +1]
  const rawScore = contributions.reduce((sum, c) => sum + c.weightedScore, 0)
  const clampedScore = Math.max(Math.min(rawScore, 1), -1)

  // 3. Check paralysis (3 consecutive stops → force continue)
  const paralysisOverride =
    ctx.slotMemory.consecutiveStops >= resolvedConfig.paralysisThreshold &&
    clampedScore <= -resolvedConfig.warnThreshold

  // 4. Map score to action
  const action = paralysisOverride
    ? "continue"
    : mapScoreToAction(clampedScore, resolvedConfig)

  // 5. Build evidence array (cite-or-abstain)
  const evidence: Evidence[] = []
  if (action !== "continue" || Math.abs(clampedScore) < resolvedConfig.continueThreshold) {
    // Non-silent actions require at least 1 evidence unit
    for (const c of contributions) {
      if (Math.abs(c.weightedScore) > 0.01) {
        evidence.push({
          source: c.source,
          value: c.description,
          confidence: Math.abs(c.rawScore),
          weight: c.weight,
        })
      }
    }
    // Ensure at least 1 evidence for non-continue actions
    if (evidence.length === 0 && action !== "continue") {
      evidence.push({
        source: "ambient",
        value: buildReasoning(clampedScore, action, contributions, paralysisOverride),
        confidence: 0.5,
        weight: 0.1,
      })
    }
  }

  // 6. Select escalation target
  const shouldEscalateTo =
    action === "escalate" ? selectEscalationTarget(ctx, resolvedConfig) : null

  // 7. Build decision
  const decision: Decision = {
    action,
    score: clampedScore,
    reasoning: buildReasoning(clampedScore, action, contributions, paralysisOverride),
    evidence,
    shouldEscalateTo,
  }

  return {
    decision,
    contributions,
    rawScore: clampedScore,
    paralysisOverride,
    computedAtISO: new Date().toISOString(),
  }
}
