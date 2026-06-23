import { describe, expect, it } from "bun:test"

import { analyzeProofChain } from "./proof-chain-analyzer.ts"

function createArtifact(proofChain: unknown[]) {
  return {
    result: {
      conclusions: {
        goal: {
          status: "Accepted",
          proof_chain: proofChain,
        },
      },
      extensions: [{ accepted_conclusions: ["goal"] }],
    },
  }
}

describe("analyzeProofChain", () => {
  it("returns empty analysis for an empty proof chain", () => {
    const result = analyzeProofChain(createArtifact([]), "goal")

    expect(result.ruleIds).toEqual([])
    expect(result.antecedents).toEqual(new Map())
    expect(result.depth).toBe(0)
    expect(result.hasCircularDependency).toBe(false)
    expect(result.allPremisesOrdinary).toBeNull()
  })

  it("marks allPremisesOrdinary true for an all-ordinary chain", () => {
    const result = analyzeProofChain(
      createArtifact([
        { conclusion: "p", rule_kind: "ordinary", antecedents: [] },
        { conclusion: "goal", rule_kind: "ordinary", antecedents: ["p"] },
      ]),
      "goal"
    )

    expect(result.allPremisesOrdinary).toBe(true)
  })

  it("marks allPremisesOrdinary false for a mixed chain", () => {
    const result = analyzeProofChain(
      createArtifact([
        { conclusion: "p", rule_kind: "ordinary", antecedents: [] },
        { conclusion: "goal", rule_kind: "defeasible", rule_id: "d1", antecedents: ["p"] },
      ]),
      "goal"
    )

    expect(result.allPremisesOrdinary).toBe(false)
  })

  it("counts only non-ordinary steps for depth", () => {
    const result = analyzeProofChain(
      createArtifact([
        { conclusion: "p", rule_kind: "ordinary", antecedents: [] },
        { conclusion: "q", rule_kind: "strict", rule_id: "s1", antecedents: ["p"] },
        { conclusion: "goal", rule_kind: "defeasible", rule_id: "d1", antecedents: ["q"] },
      ]),
      "goal"
    )

    expect(result.depth).toBe(2)
  })

  it("extracts ruleIds in proof-chain order", () => {
    const result = analyzeProofChain(
      createArtifact([
        { conclusion: "p", rule_kind: "ordinary", antecedents: [] },
        { conclusion: "q", rule_kind: "strict", rule_id: "s1", antecedents: ["p"] },
        { conclusion: "goal", rule_kind: "defeasible", rule_id: "d1", antecedents: ["q"] },
      ]),
      "goal"
    )

    expect(result.ruleIds).toEqual(["s1", "d1"])
  })

  it("populates antecedents by rule id", () => {
    const result = analyzeProofChain(
      createArtifact([
        { conclusion: "p", rule_kind: "ordinary", antecedents: [] },
        { conclusion: "goal", rule_kind: "strict", rule_id: "s1", antecedents: ["p", "q"] },
      ]),
      "goal"
    )

    expect(result.antecedents).toEqual(new Map([["s1", ["p", "q"]]]))
  })

  it("does not report a cycle for a linear dependency chain", () => {
    const result = analyzeProofChain(
      createArtifact([
        { conclusion: "p", rule_kind: "ordinary", antecedents: [] },
        { conclusion: "q", rule_kind: "strict", rule_id: "s1", antecedents: ["p"] },
        { conclusion: "goal", rule_kind: "defeasible", rule_id: "d1", antecedents: ["q"] },
      ]),
      "goal"
    )

    expect(result.hasCircularDependency).toBe(false)
  })

  it("detects a cycle when a conclusion appears in its own ancestry", () => {
    const result = analyzeProofChain(
      createArtifact([
        { conclusion: "p", rule_kind: "ordinary", antecedents: ["goal"] },
        { conclusion: "goal", rule_kind: "defeasible", rule_id: "d1", antecedents: ["p"] },
      ]),
      "goal"
    )

    expect(result.hasCircularDependency).toBe(true)
  })

  it("returns empty analysis when the requested conclusion is missing", () => {
    const result = analyzeProofChain(createArtifact([]), "missing")

    expect(result).toEqual({
      ruleIds: [],
      antecedents: new Map(),
      depth: 0,
      hasCircularDependency: false,
      allPremisesOrdinary: null,
    })
  })
})
