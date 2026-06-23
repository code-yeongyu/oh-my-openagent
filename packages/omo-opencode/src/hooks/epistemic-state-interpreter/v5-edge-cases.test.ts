import { describe, expect, test } from "bun:test"

import { computeConfidence } from "./confidence-scorer"
import { rankDominance } from "./dominance-ranker"
import { analyzeProofChain } from "./proof-chain-analyzer"
import { resolveState } from "./state-resolver"
import type { EpistemicAnnotation } from "./types"
import type { AnalyzedProofChain, ConfidenceScore, DominanceResult } from "./v5-types"

describe("epistemic-state-interpreter v5 edge cases", () => {
  describe("#given an empty proof chain", () => {
    test("#when analyzed #then depth is 0 and allPremisesOrdinary is null", () => {
      const result = analyzeProofChain({ result: { conclusions: {} } }, "nonexistent")

      expect(result.depth).toBe(0)
      expect(result.allPremisesOrdinary).toBeNull()
      expect(result.ruleIds).toEqual([])
    })
  })

  describe("#given a proof chain with circular dependencies", () => {
    test("#when analyzed #then hasCircularDependency is true", () => {
      const artifact = {
        result: {
          conclusions: {
            cyclic: {
              proof_chain: [
                { conclusion: "cyclic", rule_kind: "strict", rule_id: "s1", antecedents: ["dep"] },
                { conclusion: "dep", rule_kind: "strict", rule_id: "s2", antecedents: ["cyclic"] },
              ],
            },
          },
        },
      }

      const result = analyzeProofChain(artifact, "cyclic")
      expect(result.hasCircularDependency).toBe(true)
    })
  })

  describe("#given zero annotations", () => {
    test("#when dominance is ranked #then the result is empty and inconclusive", () => {
      const result = rankDominance([], 0.1)

      expect(result.ranking).toEqual([])
      expect(result.dominant).toBeNull()
      expect(result.margin).toBe(0)
      expect(result.isConclusive).toBe(false)
    })
  })

  describe("#given a single annotation", () => {
    test("#when dominance is ranked #then it is trivially dominant", () => {
      const annotation: EpistemicAnnotation = {
        conclusion: "solo",
        state: "accepted",
        rawClassification: "accepted",
        reason: "solo-reason",
        timestamp: 1,
        callID: "call-1",
        proofChainKind: "strict",
        extensionMembership: { inCount: 1, totalCount: 1 },
      }

      const result = rankDominance([annotation], 0.1)
      expect(result.dominant).toBe("solo")
      expect(result.margin).toBe(1)
      expect(result.isConclusive).toBe(true)
    })
  })

  describe("#given confidence exactly at the threshold boundary", () => {
    test("#when confidence is exactly 0.7 #then it is NOT inconclusive", () => {
      const confidence: ConfidenceScore = {
        value: 0.7,
        factors: { extensionRatio: 0.7, proofChainDepth: null, ruleStrength: null },
        reason: null,
      }

      const result = resolveState("accepted", confidence, undefined, undefined, {
        confidence_min: 0.7,
        dominance_margin_min: 0.1,
      })
      expect(result.state).toBe("accepted")
    })
  })

  describe("#given dominance margin exactly at the threshold boundary", () => {
    test("#when margin is exactly 0.1 #then it is NOT inconclusive", () => {
      const dominance: DominanceResult = {
        ranking: [
          { conclusion: "A", score: 0.8 },
          { conclusion: "B", score: 0.7 },
        ],
        dominant: "A",
        margin: 0.1,
        isConclusive: true,
      }

      const result = resolveState("accepted", undefined, undefined, dominance, {
        confidence_min: 0.7,
        dominance_margin_min: 0.1,
      })
      expect(result.state).toBe("accepted")
    })
  })

  describe("#given a null proof artifact", () => {
    test("#when the proof chain is analyzed #then it returns a graceful empty result", () => {
      const result = analyzeProofChain(null, "anything")

      expect(result.depth).toBe(0)
      expect(result.ruleIds).toEqual([])
      expect(result.hasCircularDependency).toBe(false)
      expect(result.allPremisesOrdinary).toBeNull()
    })
  })

  describe("#given zero totalCount in extension membership", () => {
    test("#when confidence is computed #then extensionRatio is null", () => {
      const chain: AnalyzedProofChain = {
        ruleIds: ["s1"],
        antecedents: new Map<string, string[]>(),
        depth: 1,
        hasCircularDependency: false,
        allPremisesOrdinary: false,
      }

      const result = computeConfidence(
        { inCount: 0, totalCount: 0 },
        chain,
        { extensionRatio: 0.4, proofChainDepth: 0.3, ruleStrength: 0.3 },
      )
      expect(result.factors.extensionRatio).toBeNull()
      expect(result.value).not.toBeNull()
    })
  })
})
