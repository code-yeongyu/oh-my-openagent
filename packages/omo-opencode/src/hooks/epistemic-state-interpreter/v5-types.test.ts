import { describe, expect, test } from "bun:test"

import type {
  AnalyzedProofChain,
  ConfidenceScore,
  DependencyInfo,
  DominanceResult,
  InconclusiveReason,
} from "./v5-types"

describe("v5-types", () => {
  describe("given confidence score data", () => {
    test("then the type is importable and assignable", () => {
      const confidenceScore: ConfidenceScore = {
        value: 0.75,
        factors: {
          extensionRatio: 0.5,
          proofChainDepth: 0.8,
          ruleStrength: 0.9,
        },
        reason: null,
      }

      expect(confidenceScore.factors.extensionRatio).toBe(0.5)
    })
  })

  describe("given proof chain data", () => {
    test("then the type is importable and assignable", () => {
      const analyzedProofChain: AnalyzedProofChain = {
        ruleIds: ["r1", "r2"],
        antecedents: new Map([
          ["r1", ["p"]],
          ["r2", ["q"]],
        ]),
        depth: 2,
        hasCircularDependency: false,
        allPremisesOrdinary: true,
      }

      const dependencyInfo: DependencyInfo = {
        selfSufficient: false,
        dependencyChain: analyzedProofChain.ruleIds,
        hasCircularDependency: analyzedProofChain.hasCircularDependency,
      }

      expect(dependencyInfo.dependencyChain).toEqual(["r1", "r2"])
    })
  })

  describe("given dominance data", () => {
    test("then the union and result types are importable and assignable", () => {
      const reason: InconclusiveReason = "no_data"
      const dominanceResult: DominanceResult = {
        ranking: [
          { conclusion: "a", score: 0.9 },
          { conclusion: "b", score: 0.7 },
        ],
        dominant: "a",
        margin: 0.2,
        isConclusive: true,
      }

      expect(reason).toBe("no_data")
      expect(dominanceResult.dominant).toBe("a")
    })
  })
})
