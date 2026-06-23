import { afterEach, describe, expect, test } from "bun:test"

import { ConfidenceWeightsSchema } from "../../config/schema/epistemic-v5"
import { enrichAnnotations } from "./annotation-enricher"
import type { EnricherConfig } from "./annotation-enricher"
import { _resetForTesting as resetAnnotations } from "./annotation-store"
import { computeConfidence } from "./confidence-scorer"
import { analyzeDependency } from "./dependency-analyzer"
import { rankDominance } from "./dominance-ranker"
import { checkGate } from "./gate-checker"
import { analyzeProofChain } from "./proof-chain-analyzer"
import { resolveState } from "./state-resolver"
import type { EpistemicAnnotation } from "./types"

const DEFAULT_WEIGHTS = { extensionRatio: 0.4, proofChainDepth: 0.3, ruleStrength: 0.3 }
const DEFAULT_THRESHOLDS = { confidence_min: 0.7, dominance_margin_min: 0.1 }

function createBaseAnnotation(
  conclusion: string,
  overrides: Partial<EpistemicAnnotation> = {},
): EpistemicAnnotation {
  return {
    conclusion,
    state: "accepted",
    rawClassification: "accepted",
    reason: `${conclusion}-reason`,
    timestamp: 1,
    callID: "call-1",
    proofChainKind: "strict",
    extensionMembership: { inCount: 1, totalCount: 1 },
    ...overrides,
  }
}

afterEach(() => {
  resetAnnotations()
})

describe("epistemic-state-interpreter v5 integration", () => {
  describe("#given a strict proof chain with full extension membership", () => {
    test("#when the full v5 pipeline runs #then the resolved state preserves the original classification", () => {
      const artifact = {
        result: {
          conclusions: {
            strong: {
              proof_chain: [
                { conclusion: "strong", rule_kind: "strict", rule_id: "s1", antecedents: ["base"] },
                { conclusion: "base", rule_kind: "strict", rule_id: "s2", antecedents: [] },
              ],
            },
          },
        },
      }

      const chain = analyzeProofChain(artifact, "strong")
      expect(chain.depth).toBe(2)
      expect(chain.ruleIds).toEqual(["s1", "s2"])

      const confidence = computeConfidence({ inCount: 5, totalCount: 5 }, chain, DEFAULT_WEIGHTS)
      expect(confidence.value).not.toBeNull()
      expect(confidence.value!).toBeGreaterThan(0.7)

      const dependency = analyzeDependency(chain)
      expect(dependency.selfSufficient).toBe(false)

      const enriched = createBaseAnnotation("strong", {
        extensionMembership: { inCount: 5, totalCount: 5 },
        confidence,
        dependency,
      })
      const dominance = rankDominance([enriched], 0.1)
      expect(dominance.dominant).toBe("strong")

      const result = resolveState("accepted", confidence, dependency, dominance, DEFAULT_THRESHOLDS)
      expect(result.state).toBe("accepted")
    })
  })

  describe("#given a low-confidence annotation checked against the dominance gate", () => {
    test("#when confidence is below threshold #then dominance gate blocks it", () => {
      const highConfidence = {
        value: 0.9,
        factors: { extensionRatio: 0.9, proofChainDepth: null, ruleStrength: null },
        reason: null,
      }
      const highResult = resolveState("accepted", highConfidence, undefined, undefined, DEFAULT_THRESHOLDS)
      expect(checkGate(highResult.state, "dominance", "high").allowed).toBe(true)

      const lowConfidence = {
        value: 0.5,
        factors: { extensionRatio: 0.5, proofChainDepth: null, ruleStrength: null },
        reason: null,
      }
      const lowResult = resolveState("accepted", lowConfidence, undefined, undefined, DEFAULT_THRESHOLDS)
      expect(lowResult.state).toBe("inconclusive")
      expect(checkGate(lowResult.state, "dominance", "low").allowed).toBe(false)
    })
  })

  describe("#given an all-ordinary chain and a mixed chain", () => {
    test("#when dependency is analyzed #then selfSufficient reflects chain purity", () => {
      const ordinaryArtifact = {
        result: {
          conclusions: {
            pure: {
              proof_chain: [
                { conclusion: "pure", rule_kind: "ordinary", rule_id: "o1", antecedents: [] },
              ],
            },
          },
        },
      }

      const ordinaryChain = analyzeProofChain(ordinaryArtifact, "pure")
      expect(ordinaryChain.allPremisesOrdinary).toBe(true)
      expect(analyzeDependency(ordinaryChain).selfSufficient).toBe(true)

      const mixedArtifact = {
        result: {
          conclusions: {
            mixed: {
              proof_chain: [
                { conclusion: "mixed", rule_kind: "strict", rule_id: "s1", antecedents: ["p"] },
                { conclusion: "p", rule_kind: "ordinary", antecedents: [] },
              ],
            },
          },
        },
      }

      const mixedChain = analyzeProofChain(mixedArtifact, "mixed")
      expect(mixedChain.allPremisesOrdinary).toBe(false)
      expect(analyzeDependency(mixedChain).selfSufficient).toBe(false)
    })
  })

  describe("#given an empty proof chain with valid extension membership", () => {
    test("#when confidence is computed #then null factors are excluded and combined uses available only", () => {
      const chain = analyzeProofChain({ result: { conclusions: {} } }, "missing")
      const confidence = computeConfidence({ inCount: 3, totalCount: 5 }, chain, DEFAULT_WEIGHTS)

      expect(confidence.factors.proofChainDepth).toBeNull()
      expect(confidence.factors.ruleStrength).toBeNull()
      expect(confidence.factors.extensionRatio).toBeCloseTo(0.6)
      expect(confidence.value).toBeCloseTo(0.6)
    })
  })

  describe("#given three annotations with different confidence scores", () => {
    test("#when dominance is ranked #then they are sorted descending by score", () => {
      const annotations = [
        createBaseAnnotation("A", {
          confidence: { value: 0.9, factors: { extensionRatio: null, proofChainDepth: null, ruleStrength: null }, reason: null },
        }),
        createBaseAnnotation("B", {
          confidence: { value: 0.5, factors: { extensionRatio: null, proofChainDepth: null, ruleStrength: null }, reason: null },
        }),
        createBaseAnnotation("C", {
          confidence: { value: 0.7, factors: { extensionRatio: null, proofChainDepth: null, ruleStrength: null }, reason: null },
        }),
      ]

      const result = rankDominance(annotations, 0.1)
      expect(result.ranking.map((r) => r.conclusion)).toEqual(["A", "C", "B"])
      expect(result.dominant).toBe("A")
      expect(result.margin).toBeCloseTo(0.2)
      expect(result.isConclusive).toBe(true)
    })
  })

  describe("#given an annotation without v5 fields", () => {
    test("#when ranked for dominance #then it does not crash", () => {
      const legacy = createBaseAnnotation("legacy")
      const result = rankDominance([legacy], 0.1)

      expect(result.dominant).toBe("legacy")
      expect(result.ranking[0].score).toBe(0)
      expect(result.isConclusive).toBe(true)
    })
  })

  describe("#given an empty config object", () => {
    test("#when ConfidenceWeightsSchema parses it #then defaults are applied", () => {
      const result = ConfidenceWeightsSchema.parse({})
      expect(result).toEqual({ extensionRatio: 0.4, proofChainDepth: 0.3, ruleStrength: 0.3 })
    })
  })

  describe("#given a session with no stored annotations", () => {
    test("#when enrichAnnotations is called #then it returns without error", () => {
      const config: EnricherConfig = {
        confidenceWeights: DEFAULT_WEIGHTS,
        dominanceThreshold: 0.1,
        inconclusiveThresholds: DEFAULT_THRESHOLDS,
      }
      expect(() => enrichAnnotations("v5-empty-session", null, config)).not.toThrow()
    })
  })
})
