/**
 * Token Predictor for MetaGovernor.
 *
 * PR 4 of 8. Computes token burn rate from recent turn metrics and recommends
 * preemptive actions (compact, switch model, delegate) before context window
 * exhaustion.
 *
 * Design:
 * - Pure function with no I/O — takes input, returns prediction.
 * - Configurable thresholds via TokenPredictorConfig.
 * - Burn rate = avg tokens/turn over sliding window.
 * - Overflow prediction: budgetLeft / burnRate = turns left.
 * - Recommendations layered: compact-now > switch-model > delegate > no-action.
 */

import type {
  TokenPredictorConfig,
  TokenPredictorInput,
  TokenPredictorOutput,
} from "./types"

/**
 * Default configuration for the token predictor.
 */
export function defaultTokenPredictorConfig(): TokenPredictorConfig {
  return {
    compactBurnRateThreshold: 500,
    compactUsageThreshold: 0.85,
    switchModelUsageThreshold: 0.95,
    delegateConsecutiveHighBurn: 5,
    windowSize: 10,
  }
}

/**
 * Calculate burn rate (avg tokens/turn) from recent turn tokens.
 * Returns 0 if no turns provided.
 */
export function calculateBurnRate(recentTurnTokens: readonly number[]): number {
  if (recentTurnTokens.length === 0) return 0
  const sum = recentTurnTokens.reduce((a, b) => a + b, 0)
  return sum / recentTurnTokens.length
}

/**
 * Count consecutive high-burn turns from the end of the window.
 */
function countConsecutiveHighBurn(
  recentTurnTokens: readonly number[],
  threshold: number
): number {
  let count = 0
  for (let i = recentTurnTokens.length - 1; i >= 0; i--) {
    if (recentTurnTokens[i] >= threshold) {
      count++
    } else {
      break
    }
  }
  return count
}

/**
 * Determine when overflow will occur based on burn rate and budget.
 * Returns ISO timestamp or null if no overflow expected.
 */
function predictOverflowTime(
  currentUsage: number,
  modelLimit: number,
  burnRate: number,
  timestampISO: string
): string | null {
  const budgetLeft = modelLimit - currentUsage
  if (budgetLeft <= 0) return timestampISO
  if (burnRate <= 0) return null

  const turnsLeft = Math.floor(budgetLeft / burnRate)
  if (turnsLeft <= 0) return timestampISO

  // Estimate ~2 seconds per turn as baseline
  const secondsLeft = turnsLeft * 2
  const overflowDate = new Date(
    new Date(timestampISO).getTime() + secondsLeft * 1000
  )
  return overflowDate.toISOString()
}

/**
 * Core prediction function. Analyzes recent turn tokens and recommends
 * an action to prevent context window exhaustion.
 */
export function predict(input: TokenPredictorInput): TokenPredictorOutput {
  const { currentUsage, modelLimit, recentTurnTokens, timestampISO, config } =
    input

  // Use at most windowSize recent turns
  const windowTokens = recentTurnTokens.slice(-config.windowSize)
  const burnRate = calculateBurnRate(windowTokens)
  const budgetLeft = modelLimit - currentUsage
  const usageRatio = modelLimit > 0 ? currentUsage / modelLimit : 1

  // Calculate confidence: more turns = higher confidence
  const confidence = Math.min(0.95, 0.3 + (windowTokens.length / config.windowSize) * 0.65)

  // Determine recommendation
  let recommendation: TokenPredictorOutput["recommendation"] = "no-action"
  let reason = "within normal parameters"

  // Layer 1: Critical — context nearly full
  if (usageRatio >= config.switchModelUsageThreshold) {
    recommendation = "switch-model"
    reason = `context usage ${(usageRatio * 100).toFixed(1)}% exceeds switch threshold ${(config.switchModelUsageThreshold * 100).toFixed(1)}%`
  }

  // Layer 2: High burn rate or usage above compact threshold
  if (
    usageRatio >= config.compactUsageThreshold ||
    burnRate >= config.compactBurnRateThreshold
  ) {
    if (recommendation === "no-action") {
      recommendation = "compact-now"
      reason =
        usageRatio >= config.compactUsageThreshold
          ? `context usage ${(usageRatio * 100).toFixed(1)}% exceeds compact threshold ${(config.compactUsageThreshold * 100).toFixed(1)}%`
          : `burn rate ${burnRate.toFixed(0)} tokens/turn exceeds threshold ${config.compactBurnRateThreshold}`
    }
  }

  // Layer 3: Sustained high burn → delegate
  const consecutiveHighBurn = countConsecutiveHighBurn(
    windowTokens,
    config.compactBurnRateThreshold
  )
  if (
    consecutiveHighBurn >= config.delegateConsecutiveHighBurn &&
    recommendation === "no-action"
  ) {
    recommendation = "delegate-to-subagent"
    reason = `${consecutiveHighBurn} consecutive high-burn turns (threshold: ${config.delegateConsecutiveHighBurn})`
  }

  const willOverflowAt = predictOverflowTime(
    currentUsage,
    modelLimit,
    burnRate,
    timestampISO
  )

  return {
    currentUsage,
    burnRate,
    budgetLeft,
    willOverflowAt,
    recommendation,
    confidence,
    modelLimit,
    windowRemaining: Math.max(0, Math.floor(budgetLeft / Math.max(burnRate, 1))),
    input: { ...input },
    computedAtISO: timestampISO,
    turnsAnalyzed: windowTokens.length,
  }
}
