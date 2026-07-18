/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { TokenPrediction, TokenPredictorConfig, TokenPredictorInput, TokenPredictorOutput, TokenRecommendation } from "./types"

describe("meta-governor token predictor types", () => {
  test("represent every token recommendation variant", () => {
    // given
    const predictions: readonly TokenPrediction[] = [
      {
        currentUsage: 50_000,
        burnRate: 200,
        budgetLeft: 150_000,
        willOverflowAt: null,
        recommendation: "no-action",
        confidence: 0.95,
        modelLimit: 200_000,
        windowRemaining: 150_000,
      },
      {
        currentUsage: 180_000,
        burnRate: 5_000,
        budgetLeft: 20_000,
        willOverflowAt: "2026-06-09T12:05:00.000Z",
        recommendation: "compact-now",
        confidence: 0.85,
        modelLimit: 200_000,
        windowRemaining: 20_000,
      },
      {
        currentUsage: 90_000,
        burnRate: 3_000,
        budgetLeft: 110_000,
        willOverflowAt: "2026-06-09T12:30:00.000Z",
        recommendation: "switch-model",
        confidence: 0.7,
        modelLimit: 200_000,
        windowRemaining: 110_000,
      },
      {
        currentUsage: 120_000,
        burnRate: 2_000,
        budgetLeft: 80_000,
        willOverflowAt: "2026-06-09T12:40:00.000Z",
        recommendation: "delegate-to-subagent",
        confidence: 0.65,
        modelLimit: 200_000,
        windowRemaining: 80_000,
      },
    ]
    const recommendations: readonly TokenRecommendation[] = ["compact-now", "switch-model", "delegate-to-subagent", "no-action"]

    // when
    const actualRecommendations = new Set(predictions.map((prediction) => prediction.recommendation))

    // then
    expect(actualRecommendations).toEqual(new Set(recommendations))
    expect(predictions[0]?.willOverflowAt).toBeNull()
  })

  test("combine predictor config, input, and output metadata", () => {
    // given
    const config: TokenPredictorConfig = {
      compactBurnRateThreshold: 500,
      compactUsageThreshold: 0.85,
      switchModelUsageThreshold: 0.95,
      delegateConsecutiveHighBurn: 5,
      windowSize: 10,
    }
    const input: TokenPredictorInput = {
      currentUsage: 100_000,
      modelLimit: 200_000,
      recentTurnTokens: [100, 200, 150],
      timestampISO: "2026-06-09T12:00:00.000Z",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      config,
    }
    const output: TokenPredictorOutput = {
      currentUsage: input.currentUsage,
      burnRate: 100,
      budgetLeft: 100_000,
      willOverflowAt: null,
      recommendation: "no-action",
      confidence: 0.8,
      modelLimit: input.modelLimit,
      windowRemaining: 100_000,
      input,
      computedAtISO: "2026-06-09T12:00:01.000Z",
      turnsAnalyzed: 3,
    }

    // when
    const analyzedEveryTurn = output.turnsAnalyzed === input.recentTurnTokens.length

    // then
    expect(input.config.windowSize).toBe(10)
    expect(output.input.providerID).toBe("anthropic")
    expect(analyzedEveryTurn).toBe(true)
  })
})
