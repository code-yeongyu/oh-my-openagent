import { describe, expect, test } from "bun:test"

import type { ConfidenceWeights } from "../../config/schema/epistemic-v5"
import type { AnalyzedProofChain } from "./v5-types"
import { computePianoB } from "./piano-b-engine"

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

describe("computePianoB", () => {
  test("computes probabile from full data and marks plausibile above the default threshold", () => {
    const result = computePianoB(
      { inCount: 4, totalCount: 4 },
      createAnalyzedChain({ depth: 3, ruleIds: ["d1", "d2"] }),
      DEFAULT_WEIGHTS,
      0.5,
    )

    expect(result).toEqual({ probabile: 0.775, plausibile: true })
  })

  test("computes probabile from full data and keeps plausibile false for low scores", () => {
    const result = computePianoB(
      { inCount: 0, totalCount: 4 },
      createAnalyzedChain({ depth: 0, ruleIds: ["d1"] }),
      DEFAULT_WEIGHTS,
      0.5,
    )

    expect(result).toEqual({ probabile: 0.15, plausibile: false })
  })

  test("treats extensionRatio as null when totalCount is 0", () => {
    const result = computePianoB(
      { inCount: 0, totalCount: 0 },
      createAnalyzedChain({ depth: 1, ruleIds: ["d1"] }),
      DEFAULT_WEIGHTS,
      0.5,
    )

    expect(result).toEqual({ probabile: 0.5, plausibile: false })
  })

  test("treats proofChainDepth as null for an empty chain", () => {
    const result = computePianoB(
      { inCount: 1, totalCount: 4 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      DEFAULT_WEIGHTS,
      0.5,
    )

    expect(result).toEqual({ probabile: 0.25, plausibile: false })
  })

  test("returns probabile null and plausibile false when all factors are unavailable", () => {
    const result = computePianoB(
      { inCount: 0, totalCount: 0 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      DEFAULT_WEIGHTS,
      0.5,
    )

    expect(result).toEqual({ probabile: null, plausibile: false })
  })

  test("respects a custom high threshold", () => {
    const result = computePianoB(
      { inCount: 3, totalCount: 5 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      { extensionRatio: 1, proofChainDepth: 0, ruleStrength: 0 },
      0.7,
    )

    expect(result).toEqual({ probabile: 0.6, plausibile: false })
  })

  test("respects a custom low threshold", () => {
    const result = computePianoB(
      { inCount: 2, totalCount: 5 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      { extensionRatio: 1, proofChainDepth: 0, ruleStrength: 0 },
      0.3,
    )

    expect(result).toEqual({ probabile: 0.4, plausibile: true })
  })

  test("uses an exclusive threshold comparison", () => {
    const result = computePianoB(
      { inCount: 1, totalCount: 2 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      { extensionRatio: 1, proofChainDepth: 0, ruleStrength: 0 },
      0.5,
    )

    expect(result).toEqual({ probabile: 0.5, plausibile: false })
  })

  test("marks plausibile true just above the threshold", () => {
    const result = computePianoB(
      { inCount: 501, totalCount: 1000 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      { extensionRatio: 1, proofChainDepth: 0, ruleStrength: 0 },
      0.5,
    )

    expect(result).toEqual({ probabile: 0.501, plausibile: true })
  })

  test("re-normalizes weights across only non-null factors", () => {
    const result = computePianoB(
      { inCount: 2, totalCount: 4 },
      createAnalyzedChain({ depth: 0, ruleIds: [] }),
      DEFAULT_WEIGHTS,
      0.5,
    )

    expect(result).toEqual({ probabile: 0.5, plausibile: false })
  })

  test("returns probabile null when available factors have zero total weight", () => {
    const result = computePianoB(
      { inCount: 1, totalCount: 1 },
      createAnalyzedChain({ depth: 1, ruleIds: ["d1"] }),
      { extensionRatio: 0, proofChainDepth: 0, ruleStrength: 0 },
      0.5,
    )

    expect(result).toEqual({ probabile: null, plausibile: false })
  })
})
