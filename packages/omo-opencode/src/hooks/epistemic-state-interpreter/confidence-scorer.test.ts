import { describe, expect, test } from "bun:test"

import type { ConfidenceWeights } from "../../config/schema/epistemic-v5"
import type { AnalyzedProofChain } from "./v5-types"
import { computeConfidence } from "./confidence-scorer"

const DEFAULT_WEIGHTS: ConfidenceWeights = {
  extensionRatio: 0.4,
  proofChainDepth: 0.3,
  ruleStrength: 0.3,
}

function createAnalyzedChain(overrides: Partial<AnalyzedProofChain> = {}): AnalyzedProofChain {
  return {
    ruleIds: ["d1"],
    antecedents: new Map(),
    depth: 1,
    hasCircularDependency: false,
    allPremisesOrdinary: true,
    ...overrides,
  }
}

describe("computeConfidence", () => {
  test("computes an extension ratio of 1.0 for 4/4", () => {
    const result = computeConfidence({ inCount: 4, totalCount: 4 }, createAnalyzedChain(), DEFAULT_WEIGHTS)

    expect(result.factors.extensionRatio).toBe(1)
  })

  test("computes an extension ratio of 0.0 for 0/4", () => {
    const result = computeConfidence({ inCount: 0, totalCount: 4 }, createAnalyzedChain(), DEFAULT_WEIGHTS)

    expect(result.factors.extensionRatio).toBe(0)
  })

  test("returns a null extension ratio when totalCount is 0", () => {
    const result = computeConfidence({ inCount: 0, totalCount: 0 }, createAnalyzedChain(), DEFAULT_WEIGHTS)

    expect(result.factors.extensionRatio).toBeNull()
  })

  test("returns a null proof chain depth for an empty chain", () => {
    const result = computeConfidence(
      { inCount: 1, totalCount: 4 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      DEFAULT_WEIGHTS,
    )

    expect(result.factors.proofChainDepth).toBeNull()
  })

  test("normalizes proof chain depth of 1 to 0.5", () => {
    const result = computeConfidence(
      { inCount: 1, totalCount: 4 },
      createAnalyzedChain({ depth: 1 }),
      DEFAULT_WEIGHTS,
    )

    expect(result.factors.proofChainDepth).toBe(0.5)
  })

  test("normalizes proof chain depth of 3 to 0.75", () => {
    const result = computeConfidence(
      { inCount: 1, totalCount: 4 },
      createAnalyzedChain({ depth: 3 }),
      DEFAULT_WEIGHTS,
    )

    expect(result.factors.proofChainDepth).toBe(0.75)
  })

  test("returns no_data when all factors are unavailable", () => {
    const result = computeConfidence(
      { inCount: 0, totalCount: 0 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      DEFAULT_WEIGHTS,
    )

    expect(result).toEqual({
      value: null,
      factors: {
        extensionRatio: null,
        proofChainDepth: null,
        ruleStrength: null,
      },
      reason: "no_data",
    })
  })

  test("computes a weighted average from non-null factors only", () => {
    const result = computeConfidence(
      { inCount: 2, totalCount: 4 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      DEFAULT_WEIGHTS,
    )

    expect(result.factors).toEqual({
      extensionRatio: 0.5,
      proofChainDepth: null,
      ruleStrength: null,
    })
    expect(result.value).toBe(0.5)
    expect(result.reason).toBeNull()
  })

  test("includes placeholder rule strength when rule ids exist", () => {
    const result = computeConfidence(
      { inCount: 1, totalCount: 4 },
      createAnalyzedChain({ ruleIds: ["d1", "d2"] }),
      DEFAULT_WEIGHTS,
    )

    expect(result.factors.ruleStrength).toBe(0.5)
  })
})
