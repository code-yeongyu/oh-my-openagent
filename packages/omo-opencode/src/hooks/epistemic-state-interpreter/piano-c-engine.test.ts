import { describe, expect, it } from "bun:test"

import { computePianoC } from "./piano-c-engine"
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

describe("computePianoC", () => {
  it("returns null autosufficiente and empty dependencies for an empty chain", () => {
    const result = computePianoC(
      createChain({
        ruleIds: [],
        allPremisesOrdinary: null,
      }),
      { inCount: 0, totalCount: 0 },
    )

    expect(result).toEqual({
      inconclusivo: false,
      autosufficiente: null,
      catena_dipendenze: [],
      ha_dipendenza_circolare: false,
    })
  })

  it("returns autosufficiente true for a non-empty all-ordinary chain", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["s1", "s2"],
        allPremisesOrdinary: true,
      }),
      { inCount: 0, totalCount: 10 },
    )

    expect(result.autosufficiente).toBe(true)
    expect(result.inconclusivo).toBe(false)
  })

  it("returns autosufficiente false for a mixed chain", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["s1", "d1"],
        antecedents: new Map([["d1", ["support(goal)"]]]),
        allPremisesOrdinary: false,
      }),
      { inCount: 1, totalCount: 4 },
    )

    expect(result.autosufficiente).toBe(false)
  })

  it("marks a defeasible chain with weak extension support as inconclusivo", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["d1"],
        antecedents: new Map([["d1", ["policy_violation(alex)"]]]),
        allPremisesOrdinary: false,
      }),
      { inCount: 1, totalCount: 4 },
    )

    expect(result.inconclusivo).toBe(true)
  })

  it("does not mark inconclusivo when extension support is strong", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["d1"],
        antecedents: new Map([["d1", ["policy_violation(alex)"]]]),
        allPremisesOrdinary: false,
      }),
      { inCount: 2, totalCount: 4 },
    )

    expect(result.inconclusivo).toBe(false)
  })

  it("propagates circular dependency state", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["d1"],
        antecedents: new Map([["d1", ["loop(goal)"]]]),
        hasCircularDependency: true,
        allPremisesOrdinary: false,
      }),
      { inCount: 1, totalCount: 4 },
    )

    expect(result.ha_dipendenza_circolare).toBe(true)
  })

  it("populates catena_dipendenze from defeasible antecedents only", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["d1", "s1", "d2"],
        antecedents: new Map([
          ["d1", ["policy_violation(alex)", "low_trust(alex)"]],
          ["s1", ["strict(signal)"]],
          ["d2", ["needs_review(alex)"]],
        ]),
        allPremisesOrdinary: false,
      }),
      { inCount: 1, totalCount: 4 },
    )

    expect(result.catena_dipendenze).toEqual([
      "policy_violation(alex)",
      "low_trust(alex)",
      "needs_review(alex)",
    ])
  })

  it("deduplicates repeated defeasible antecedents", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["d1", "d2"],
        antecedents: new Map([
          ["d1", ["shared(signal)", "unique(first)"]],
          ["d2", ["shared(signal)", "unique(second)"]],
        ]),
        allPremisesOrdinary: false,
      }),
      { inCount: 1, totalCount: 4 },
    )

    expect(result.catena_dipendenze).toEqual([
      "shared(signal)",
      "unique(first)",
      "unique(second)",
    ])
  })

  it("treats zero extension data as inconclusivo when the chain is not self-sufficient", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["d1"],
        antecedents: new Map([["d1", ["policy_violation(alex)"]]]),
        allPremisesOrdinary: false,
      }),
      { inCount: 0, totalCount: 0 },
    )

    expect(result.inconclusivo).toBe(true)
  })

  it("never marks a self-sufficient chain as inconclusivo", () => {
    const result = computePianoC(
      createChain({
        ruleIds: ["s1"],
        allPremisesOrdinary: true,
      }),
      { inCount: 0, totalCount: 0 },
    )

    expect(result.autosufficiente).toBe(true)
    expect(result.inconclusivo).toBe(false)
  })
})
