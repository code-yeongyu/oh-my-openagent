import { describe, expect, it } from "bun:test"
import { analyzeDependency } from "./dependency-analyzer"
import type { AnalyzedProofChain } from "./v5-types"

function createChain(overrides: Partial<AnalyzedProofChain> = {}): AnalyzedProofChain {
  return {
    ruleIds: ["s1"],
    antecedents: new Map<string, string[]>(),
    depth: 1,
    hasCircularDependency: false,
    allPremisesOrdinary: true,
    ...overrides,
  }
}

describe("analyzeDependency", () => {
  it("returns null selfSufficient and empty dependencyChain for an empty chain", () => {
    const result = analyzeDependency(
      createChain({
        ruleIds: [],
        allPremisesOrdinary: null,
      }),
    )

    expect(result).toEqual({
      selfSufficient: null,
      dependencyChain: [],
      hasCircularDependency: false,
    })
  })

  it("returns true selfSufficient for a non-empty all-ordinary chain", () => {
    const result = analyzeDependency(
      createChain({
        ruleIds: ["s1", "s2"],
        allPremisesOrdinary: true,
      }),
    )

    expect(result.selfSufficient).toBe(true)
  })

  it("returns false selfSufficient when any premise is non-ordinary", () => {
    const result = analyzeDependency(
      createChain({
        ruleIds: ["d1"],
        allPremisesOrdinary: false,
      }),
    )

    expect(result.selfSufficient).toBe(false)
  })

  it("populates dependencyChain from defeasible antecedents", () => {
    const result = analyzeDependency(
      createChain({
        ruleIds: ["d1", "s1", "d2"],
        antecedents: new Map([
          ["d1", ["policy_violation(alex)", "low_trust(alex)"]],
          ["s1", ["ignored(strict)"]],
          ["d2", ["needs_review(alex)"]],
        ]),
        allPremisesOrdinary: false,
      }),
    )

    expect(result.dependencyChain).toEqual([
      "policy_violation(alex)",
      "low_trust(alex)",
      "needs_review(alex)",
    ])
  })

  it("deduplicates repeated defeasible antecedents", () => {
    const result = analyzeDependency(
      createChain({
        ruleIds: ["d1", "d2"],
        antecedents: new Map([
          ["d1", ["shared(signal)", "unique(first)"]],
          ["d2", ["shared(signal)", "unique(second)"]],
        ]),
        allPremisesOrdinary: false,
      }),
    )

    expect(result.dependencyChain).toEqual([
      "shared(signal)",
      "unique(first)",
      "unique(second)",
    ])
  })

  it("propagates hasCircularDependency from the chain", () => {
    const result = analyzeDependency(
      createChain({
        ruleIds: ["d1"],
        hasCircularDependency: true,
        allPremisesOrdinary: false,
      }),
    )

    expect(result.hasCircularDependency).toBe(true)
  })
})
