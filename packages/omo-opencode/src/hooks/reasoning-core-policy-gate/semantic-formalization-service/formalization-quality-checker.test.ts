import { describe, expect, it } from "bun:test"
import { createFormalizationQualityChecker } from "./formalization-quality-checker"
import type { FormalizationRequest, Theory } from "./types"

const request: FormalizationRequest = {
  problem_statement: "Choose between two risky options",
  options: [
    "Option A: immediate intervention with severe harm risk",
    "Option B: wait and monitor",
  ],
  constraints: [],
  preferences: [],
  requested_semantics: "preferred",
}

function makeTheory(overrides: Partial<Theory> = {}): Theory {
  return {
    premises: [{ formula: "problem(current)", kind: "ordinary" }],
    strict_rules: [],
    defeasible_rules: [
      { id: "d-a", antecedents: ["problem(current)"], consequent: "select_option_a" },
      { id: "d-b", antecedents: ["problem(current)"], consequent: "select_option_b" },
    ],
    preferences: [],
    classical_negation: true,
    ...overrides,
  }
}

describe("createFormalizationQualityChecker", () => {
  it("flags duplicate selection antecedent sets across options", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({ request, theory: makeTheory(), expectedOptionAtoms: ["select_option_a", "select_option_b"] })

    expect(report.isAcceptable).toBe(false)
    expect(report.duplicateSelectionRuleSets).toEqual(["select_option_a ↔ select_option_b"])
  })

  it("flags missing harm coverage for an option whose text explicitly mentions severe harm", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({
      request,
      theory: makeTheory({
        defeasible_rules: [
          { id: "d-a", antecedents: ["problem(current)", "support(option_a)"], consequent: "select_option_a" },
          { id: "d-b", antecedents: ["problem(current)", "support(option_b)"], consequent: "select_option_b" },
        ],
        premises: [
          { formula: "problem(current)", kind: "ordinary" },
          { formula: "support(option_a) @option:option_a @value:safety", kind: "ordinary" },
          { formula: "support(option_b) @option:option_b @value:autonomy", kind: "ordinary" },
        ],
      }),
      expectedOptionAtoms: ["select_option_a", "select_option_b"],
    })

    expect(report.isAcceptable).toBe(false)
    expect(report.missingOptionHarmCoverage).toEqual(["select_option_a"])
  })

  it("accepts a theory with distinct selection support and explicit harm coverage", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({
      request,
      theory: makeTheory({
        defeasible_rules: [
          { id: "d-a", antecedents: ["problem(current)", "support(option_a) @option:option_a @value:safety"], consequent: "select_option_a" },
          { id: "d-b", antecedents: ["problem(current)", "support(option_b) @option:option_b @value:autonomy"], consequent: "select_option_b" },
        ],
        premises: [
          { formula: "problem(current)", kind: "ordinary" },
          { formula: "support(option_a) @option:option_a @value:safety", kind: "ordinary" },
          { formula: "harm(option_a) @option:option_a @valence:harm:severe @value:dignity", kind: "ordinary" },
          { formula: "support(option_b) @option:option_b @value:autonomy", kind: "ordinary" },
        ],
      }),
      expectedOptionAtoms: ["select_option_a", "select_option_b"],
    })

    expect(report.isAcceptable).toBe(true)
    expect(report.duplicateSelectionRuleSets).toEqual([])
    expect(report.missingOptionHarmCoverage).toEqual([])
  })

  it("treats rule consequents as valid harm coverage for risky options", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({
      request,
      theory: makeTheory({
        defeasible_rules: [
          { id: "d-a", antecedents: ["problem(current)", "support(option_a) @option:option_a @value:safety"], consequent: "select_option_a" },
          { id: "d-b", antecedents: ["problem(current)", "support(option_b) @option:option_b @value:autonomy"], consequent: "select_option_b" },
        ],
        strict_rules: [
          { id: "s-a", antecedents: ["problem(current)"], consequent: "harm(option_a) @option:option_a @valence:harm:severe @value:dignity" },
        ],
        premises: [
          { formula: "problem(current)", kind: "ordinary" },
          { formula: "support(option_a) @option:option_a @value:safety", kind: "ordinary" },
          { formula: "support(option_b) @option:option_b @value:autonomy", kind: "ordinary" },
        ],
      }),
      expectedOptionAtoms: ["select_option_a", "select_option_b"],
    })

    expect(report.isAcceptable).toBe(true)
    expect(report.missingOptionHarmCoverage).toEqual([])
  })
})
