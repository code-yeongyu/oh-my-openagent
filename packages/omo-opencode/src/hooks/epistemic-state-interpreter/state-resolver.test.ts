import { describe, expect, test } from "bun:test"

import type { ConfidenceScore, DependencyInfo, DominanceResult } from "./v5-types"
import { resolveState } from "./state-resolver"

const DEFAULT_THRESHOLDS = {
  confidence_min: 0.7,
  dominance_margin_min: 0.1,
}

function createConfidence(overrides: Partial<ConfidenceScore> = {}): ConfidenceScore {
  return {
    value: 0.8,
    factors: {
      extensionRatio: 0.8,
      proofChainDepth: 0.8,
      ruleStrength: 0.8,
    },
    reason: null,
    ...overrides,
  }
}

function createDependency(overrides: Partial<DependencyInfo> = {}): DependencyInfo {
  return {
    selfSufficient: true,
    dependencyChain: [],
    hasCircularDependency: false,
    ...overrides,
  }
}

function createDominance(overrides: Partial<DominanceResult> = {}): DominanceResult {
  return {
    ranking: [{ conclusion: "accepted(policy)", score: 0.8 }],
    dominant: "accepted(policy)",
    margin: 0.4,
    isConclusive: true,
    ...overrides,
  }
}

describe("resolveState", () => {
  test("preserves the original state when no inconclusive trigger is present", () => {
    const result = resolveState(
      "accepted",
      createConfidence(),
      createDependency(),
      createDominance(),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({ state: "accepted" })
  })

  test("returns inconclusive for a circular dependency", () => {
    const result = resolveState(
      "plausible",
      createConfidence(),
      createDependency({ hasCircularDependency: true }),
      createDominance(),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({
      state: "inconclusive",
      inconclusiveReason: "circular_dependency",
    })
  })

  test("returns inconclusive for confidence below the threshold", () => {
    const result = resolveState(
      "open",
      createConfidence({ value: 0.69 }),
      createDependency(),
      createDominance(),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({
      state: "inconclusive",
      inconclusiveReason: "low_confidence",
    })
  })

  test("does not return inconclusive when confidence is exactly at the threshold", () => {
    const result = resolveState(
      "open",
      createConfidence({ value: 0.7 }),
      createDependency(),
      createDominance(),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({ state: "open" })
  })

  test("ignores null confidence values", () => {
    const result = resolveState(
      "excluded",
      createConfidence({ value: null, reason: "no_data" }),
      createDependency(),
      createDominance(),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({ state: "excluded" })
  })

  test("returns inconclusive for dominance margin below the threshold", () => {
    const result = resolveState(
      "operationally_excluded",
      createConfidence(),
      createDependency(),
      createDominance({ margin: 0.09, isConclusive: false }),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({
      state: "inconclusive",
      inconclusiveReason: "narrow_margin",
    })
  })

  test("does not return inconclusive when dominance margin is exactly at the threshold", () => {
    const result = resolveState(
      "accepted",
      createConfidence(),
      createDependency(),
      createDominance({ margin: 0.1, isConclusive: true }),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({ state: "accepted" })
  })

  test("prefers circular_dependency over low_confidence and narrow_margin", () => {
    const result = resolveState(
      "plausible",
      createConfidence({ value: 0.2 }),
      createDependency({ hasCircularDependency: true }),
      createDominance({ margin: 0.01, isConclusive: false }),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({
      state: "inconclusive",
      inconclusiveReason: "circular_dependency",
    })
  })

  test("prefers low_confidence over narrow_margin when both apply", () => {
    const result = resolveState(
      "plausible",
      createConfidence({ value: 0.2 }),
      createDependency(),
      createDominance({ margin: 0.01, isConclusive: false }),
      DEFAULT_THRESHOLDS,
    )

    expect(result).toEqual({
      state: "inconclusive",
      inconclusiveReason: "low_confidence",
    })
  })
})
