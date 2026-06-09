import { describe, expect, it } from "bun:test"
import type { TokenPredictorConfig, TokenPredictorInput } from "./types"
import {
  calculateBurnRate,
  defaultTokenPredictorConfig,
  predict,
} from "./token-predictor"

function makeInput(
  overrides: Partial<TokenPredictorInput> = {}
): TokenPredictorInput {
  return {
    currentUsage: 50_000,
    modelLimit: 200_000,
    recentTurnTokens: [100, 120, 80, 110, 90],
    timestampISO: "2026-06-09T15:00:00Z",
    providerID: "anthropic",
    modelID: "claude-sonnet-4-20250514",
    config: defaultTokenPredictorConfig(),
    ...overrides,
  }
}

// #given TokenPredictorConfig defaults
describe("#given defaultTokenPredictorConfig", () => {
  // #then returns sane defaults
  it("returns sane defaults", () => {
    const config = defaultTokenPredictorConfig()
    expect(config.compactBurnRateThreshold).toBe(500)
    expect(config.compactUsageThreshold).toBe(0.85)
    expect(config.switchModelUsageThreshold).toBe(0.95)
    expect(config.delegateConsecutiveHighBurn).toBe(5)
    expect(config.windowSize).toBe(10)
  })
})

// #given calculateBurnRate
describe("#given calculateBurnRate", () => {
  // #then returns 0 for empty array
  it("returns 0 for empty array", () => {
    expect(calculateBurnRate([])).toBe(0)
  })

  // #then returns average for single turn
  it("returns average for single turn", () => {
    expect(calculateBurnRate([1000])).toBe(1000)
  })

  // #then returns correct average for multiple turns
  it("returns correct average for multiple turns", () => {
    expect(calculateBurnRate([1000, 2000, 3000])).toBe(2000)
  })

  // #then handles fractional averages
  it("handles fractional averages", () => {
    expect(calculateBurnRate([100, 150])).toBe(125)
  })
})

// #given predict with normal usage
describe("#given predict with normal usage", () => {
  // #then returns no-action recommendation
  it("returns no-action recommendation", () => {
    const result = predict(makeInput())
    expect(result.recommendation).toBe("no-action")
  })

  // #then calculates correct burn rate
  it("calculates correct burn rate", () => {
    const result = predict(makeInput())
    expect(result.burnRate).toBe(100)
  })

  // #then calculates correct budget left
  it("calculates correct budget left", () => {
    const result = predict(makeInput())
    expect(result.budgetLeft).toBe(150_000)
  })

  // #then sets confidence based on window fill
  it("sets confidence based on window fill", () => {
    const result = predict(makeInput())
    // 5 turns / 10 window = 0.5 → confidence = 0.3 + 0.5 * 0.65 = 0.625
    expect(result.confidence).toBeCloseTo(0.625, 2)
  })
})

// #given predict with high usage
describe("#given predict with high usage", () => {
  // #then recommends compact-now when above compact threshold
  it("recommends compact-now when above compact threshold", () => {
    const result = predict(
      makeInput({ currentUsage: 175_000 }) // 87.5% > 85%
    )
    expect(result.recommendation).toBe("compact-now")
  })

  // #then recommends switch-model when above switch threshold
  it("recommends switch-model when above switch threshold", () => {
    const result = predict(
      makeInput({ currentUsage: 192_000 }) // 96% > 95%
    )
    expect(result.recommendation).toBe("switch-model")
  })
})

// #given predict with high burn rate
describe("#given predict with high burn rate", () => {
  // #then recommends compact-now when burn rate exceeds threshold
  it("recommends compact-now when burn rate exceeds threshold", () => {
    const result = predict(
      makeInput({
        recentTurnTokens: [600, 700, 800, 500, 2000],
        // avg = 920, but the 2000 is high
      })
    )
    // avg = (600+700+800+500+2000)/5 = 920 > 500
    expect(result.recommendation).toBe("compact-now")
    expect(result.burnRate).toBe(920)
  })
})

// #given predict with consecutive high burn
describe("#given predict with consecutive high burn", () => {
  // #then recommends delegate after threshold consecutive turns
  it("recommends delegate after threshold consecutive turns", () => {
    const result = predict(
      makeInput({
        recentTurnTokens: [100, 200, 600, 600, 600, 600, 600],
        // last 5 turns are all >= 500
      })
    )
    expect(result.recommendation).toBe("delegate-to-subagent")
  })

  // #then does not delegate when consecutive count below threshold
  it("does not delegate when consecutive count below threshold", () => {
    const result = predict(
      makeInput({
        recentTurnTokens: [100, 600, 600, 600, 600, 100, 600],
        // last 1 is high but not 5 consecutive
      })
    )
    expect(result.recommendation).toBe("no-action")
  })
})

// #given predict priority ordering
describe("#given predict priority ordering", () => {
  // #then switch-model takes priority over compact-now
  it("switch-model takes priority over compact-now", () => {
    const result = predict(
      makeInput({
        currentUsage: 192_000, // 96% > switch threshold
        recentTurnTokens: [600, 700, 800, 500, 2000], // high burn too
      })
    )
    expect(result.recommendation).toBe("switch-model")
  })
})

// #given predict window limiting
describe("#given predict window limiting", () => {
  // #then uses at most windowSize turns
  it("uses at most windowSize turns", () => {
    const result = predict(
      makeInput({
        recentTurnTokens: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 5000],
        config: { ...defaultTokenPredictorConfig(), windowSize: 5 },
      })
    )
    // Last 5 turns: [100, 100, 100, 100, 5000] → avg = 1080
    expect(result.turnsAnalyzed).toBe(5)
    expect(result.burnRate).toBe(1080)
  })
})

// #given predict overflow prediction
describe("#given predict overflow prediction", () => {
  // #then returns null when not expected to overflow
  it("returns null when not expected to overflow", () => {
    // With empty turns, burn rate = 0, overflow is never predicted
    const result = predict(makeInput({
      recentTurnTokens: [],
    }))
    expect(result.willOverflowAt).toBeNull()
  })

  // #then returns ISO timestamp when overflow is imminent
  it("returns ISO timestamp when overflow is imminent", () => {
    const result = predict(
      makeInput({ currentUsage: 199_000, modelLimit: 200_000 })
    )
    expect(result.willOverflowAt).not.toBeNull()
  })
})

// #given predict with empty turns
describe("#given predict with empty turns", () => {
  // #then handles empty recentTurnTokens gracefully
  it("handles empty recentTurnTokens gracefully", () => {
    const result = predict(makeInput({ recentTurnTokens: [] }))
    expect(result.burnRate).toBe(0)
    expect(result.recommendation).toBe("no-action")
    expect(result.turnsAnalyzed).toBe(0)
  })
})
