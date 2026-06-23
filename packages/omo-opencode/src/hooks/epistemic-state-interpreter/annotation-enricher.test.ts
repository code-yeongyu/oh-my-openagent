import { afterEach, describe, expect, test } from "bun:test"
import { getAnnotations, storeAnnotations, _resetForTesting as resetAnnotations } from "./annotation-store"
import { enrichAnnotations } from "./annotation-enricher"

const SESSION_ID = "annotation-enricher-session"

const CONFIG = {
  confidenceWeights: {
    extensionRatio: 0.4,
    proofChainDepth: 0.3,
    ruleStrength: 0.3,
  },
  dominanceThreshold: 0.7,
  inconclusiveThresholds: {
    confidence_min: 0.7,
    dominance_margin_min: 0.1,
  },
} as const

afterEach(() => {
  resetAnnotations()
})

describe("enrichAnnotations", () => {
  test("adds confidence and dependency data without duplicating annotations", () => {
    storeAnnotations(SESSION_ID, [
      {
        conclusion: "c(x)",
        state: "accepted",
        rawClassification: "accepted",
        reason: "status=Accepted extensions=1/1",
        timestamp: 1,
        callID: "call-1",
        proofChainKind: "defeasible",
        extensionMembership: { inCount: 1, totalCount: 1 },
      },
    ])

    enrichAnnotations(
      SESSION_ID,
      {
        result: {
          conclusions: {
            "c(x)": {
              proof_chain: [
                { conclusion: "premise(x)", from: [], rule_kind: "ordinary" },
                { conclusion: "c(x)", from: ["premise(x)"], rule_id: "d1", rule_kind: "defeasible" },
              ],
            },
          },
        },
      },
      CONFIG,
    )

    const annotations = getAnnotations(SESSION_ID)
    expect(annotations).toHaveLength(1)
    expect(annotations[0]?.confidence?.value).toBeGreaterThan(0)
    expect(annotations[0]?.dependency).toEqual({
      selfSufficient: false,
      dependencyChain: ["premise(x)"],
      hasCircularDependency: false,
    })
  })
})
