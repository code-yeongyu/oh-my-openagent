import { describe, expect, test } from "bun:test"

import { rankDominance } from "./dominance-ranker"
import type { EpistemicAnnotation } from "./types"

const DOMINANCE_THRESHOLD = 0.2

function createAnnotation(overrides: Partial<EpistemicAnnotation> = {}): EpistemicAnnotation {
  return {
    conclusion: "allow(alex)",
    state: "accepted",
    rawClassification: "accepted",
    reason: "test",
    timestamp: 1,
    callID: "call-1",
    proofChainKind: "defeasible",
    extensionMembership: { inCount: 1, totalCount: 1 },
    confidence: {
      value: 0.5,
      factors: {
        extensionRatio: 0.5,
        proofChainDepth: 0.5,
        ruleStrength: 0.5,
      },
      reason: null,
    },
    dependency: {
      selfSufficient: false,
      dependencyChain: [],
      hasCircularDependency: false,
    },
    ...overrides,
  }
}

describe("rankDominance", () => {
  test("returns an empty inconclusive result for no annotations", () => {
    expect(rankDominance([], DOMINANCE_THRESHOLD)).toEqual({
      ranking: [],
      dominant: null,
      margin: 0,
      isConclusive: false,
    })
  })

  test("treats a single annotation as trivially dominant", () => {
    const result = rankDominance([createAnnotation()], DOMINANCE_THRESHOLD)

    expect(result).toEqual({
      ranking: [{ conclusion: "allow(alex)", score: 0.5 }],
      dominant: "allow(alex)",
      margin: 1,
      isConclusive: true,
    })
  })

  test("selects the dominant conclusion when the top score clears the threshold", () => {
    const result = rankDominance(
      [
        createAnnotation({ conclusion: "allow(alex)", confidence: { ...createAnnotation().confidence!, value: 0.9 } }),
        createAnnotation({ conclusion: "deny(alex)", confidence: { ...createAnnotation().confidence!, value: 0.4 } }),
      ],
      DOMINANCE_THRESHOLD,
    )

    expect(result.dominant).toBe("allow(alex)")
    expect(result.margin).toBe(0.5)
    expect(result.isConclusive).toBe(true)
  })

  test("returns no dominant conclusion when the top scores are too close", () => {
    const result = rankDominance(
      [
        createAnnotation({ conclusion: "allow(alex)", confidence: { ...createAnnotation().confidence!, value: 0.7 } }),
        createAnnotation({ conclusion: "deny(alex)", confidence: { ...createAnnotation().confidence!, value: 0.55 } }),
      ],
      DOMINANCE_THRESHOLD,
    )

    expect(result.dominant).toBeNull()
    expect(result.margin).toBe(0.15)
    expect(result.isConclusive).toBe(false)
  })

  test("adds a self-sufficient bonus to the annotation score", () => {
    const result = rankDominance(
      [
        createAnnotation({
          conclusion: "allow(alex)",
          confidence: { ...createAnnotation().confidence!, value: 0.5 },
          dependency: { selfSufficient: true, dependencyChain: [], hasCircularDependency: false },
        }),
        createAnnotation({
          conclusion: "deny(alex)",
          confidence: { ...createAnnotation().confidence!, value: 0.52 },
        }),
      ],
      0.01,
    )

    expect(result.ranking).toEqual([
      { conclusion: "allow(alex)", score: 0.55 },
      { conclusion: "deny(alex)", score: 0.52 },
    ])
  })

  test("treats null confidence as a zero base score", () => {
    const result = rankDominance(
      [
        createAnnotation({
          conclusion: "allow(alex)",
          confidence: { ...createAnnotation().confidence!, value: null, reason: "no_data" },
        }),
        createAnnotation({ conclusion: "deny(alex)", confidence: { ...createAnnotation().confidence!, value: 0.1 } }),
      ],
      DOMINANCE_THRESHOLD,
    )

    expect(result.ranking).toEqual([
      { conclusion: "deny(alex)", score: 0.1 },
      { conclusion: "allow(alex)", score: 0 },
    ])
  })

  test("sorts the ranking in descending score order", () => {
    const result = rankDominance(
      [
        createAnnotation({ conclusion: "third", confidence: { ...createAnnotation().confidence!, value: 0.2 } }),
        createAnnotation({ conclusion: "first", confidence: { ...createAnnotation().confidence!, value: 0.9 } }),
        createAnnotation({ conclusion: "second", confidence: { ...createAnnotation().confidence!, value: 0.4 } }),
      ],
      DOMINANCE_THRESHOLD,
    )

    expect(result.ranking).toEqual([
      { conclusion: "first", score: 0.9 },
      { conclusion: "second", score: 0.4 },
      { conclusion: "third", score: 0.2 },
    ])
  })

  test("treats a margin exactly at the threshold as conclusive", () => {
    const result = rankDominance(
      [
        createAnnotation({ conclusion: "allow(alex)", confidence: { ...createAnnotation().confidence!, value: 0.7 } }),
        createAnnotation({ conclusion: "deny(alex)", confidence: { ...createAnnotation().confidence!, value: 0.5 } }),
      ],
      DOMINANCE_THRESHOLD,
    )

    expect(result.margin).toBe(0.2)
    expect(result.dominant).toBe("allow(alex)")
    expect(result.isConclusive).toBe(true)
  })
})
