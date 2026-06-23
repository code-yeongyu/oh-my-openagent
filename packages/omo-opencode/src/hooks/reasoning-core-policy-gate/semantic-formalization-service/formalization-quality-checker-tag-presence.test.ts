import { describe, expect, it } from "bun:test"
import { createFormalizationQualityChecker } from "./formalization-quality-checker"
import type { FormalizationRequest, Theory } from "./types"

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

const benignRequest: FormalizationRequest = {
  problem_statement: "Choose between two benign options",
  options: ["Option A: do thing one", "Option B: do thing two"],
  constraints: [],
  preferences: [],
  requested_semantics: "preferred",
}

describe("createFormalizationQualityChecker > tag-presence per Formalizer 8 rules", () => {
  it("flags options missing any @option:<id> tag (Rule 2/6)", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({
      request: benignRequest,
      theory: makeTheory({
        defeasible_rules: [
          { id: "d-a", antecedents: ["problem(current)", "support(option_a) @value:safety"], consequent: "select_option_a" },
          { id: "d-b", antecedents: ["problem(current)", "support(option_b) @value:autonomy"], consequent: "select_option_b" },
        ],
        premises: [
          { formula: "problem(current)", kind: "ordinary" },
          { formula: "support(option_a) @value:safety", kind: "ordinary" },
          { formula: "support(option_b) @value:autonomy", kind: "ordinary" },
        ],
      }),
      expectedOptionAtoms: ["select_option_a", "select_option_b"],
    })

    expect(report.isAcceptable).toBe(false)
    expect(report.missingOptionTags).toEqual(["select_option_a", "select_option_b"])
    expect(report.qualityWarnings.some((w) => w.includes("Missing @option:option_a tag"))).toBe(true)
  })

  it("flags tags appended to bare select_option_X consequents (Rule 7)", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({
      request: benignRequest,
      theory: makeTheory({
        defeasible_rules: [
          { id: "d-a", antecedents: ["problem(current)", "support(option_a) @option:option_a"], consequent: "select_option_a @value:safety" },
          { id: "d-b", antecedents: ["problem(current)", "support(option_b) @option:option_b"], consequent: "select_option_b" },
        ],
        premises: [
          { formula: "problem(current)", kind: "ordinary" },
          { formula: "support(option_a) @option:option_a", kind: "ordinary" },
          { formula: "support(option_b) @option:option_b", kind: "ordinary" },
        ],
      }),
      expectedOptionAtoms: ["select_option_a @value:safety", "select_option_b"],
    })

    expect(report.isAcceptable).toBe(false)
    expect(report.taggedSelectionAtoms).toContain("select_option_a @value:safety")
    expect(report.qualityWarnings.some((w) => w.includes("tag appended to bare selection atom"))).toBe(true)
  })

  it("flags missing @value:* tags when request preferences mention abstract values (Rule 6 mandate)", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({
      request: {
        problem_statement: "Pick option respecting safety and autonomy",
        options: ["Option A", "Option B"],
        constraints: [],
        preferences: [{ superior: "safety", inferior: "autonomy" }],
        requested_semantics: "preferred",
      },
      theory: makeTheory({
        defeasible_rules: [
          { id: "d-a", antecedents: ["problem(current)", "support(option_a) @option:option_a"], consequent: "select_option_a" },
          { id: "d-b", antecedents: ["problem(current)", "support(option_b) @option:option_b"], consequent: "select_option_b" },
        ],
        premises: [
          { formula: "problem(current)", kind: "ordinary" },
          { formula: "support(option_a) @option:option_a", kind: "ordinary" },
          { formula: "support(option_b) @option:option_b", kind: "ordinary" },
        ],
      }),
      expectedOptionAtoms: ["select_option_a", "select_option_b"],
    })

    expect(report.isAcceptable).toBe(false)
    expect(report.missingValueTags).toContain("safety")
    expect(report.missingValueTags).toContain("autonomy")
    expect(report.qualityWarnings.some((w) => w.toLowerCase().includes("value tag"))).toBe(true)
  })

  it("accepts theories with @option markers, bare selection atoms, and @value tags matching preferences", () => {
    const checker = createFormalizationQualityChecker()
    const report = checker.check({
      request: {
        problem_statement: "Pick option respecting safety",
        options: ["Option A", "Option B"],
        constraints: [],
        preferences: [{ superior: "safety", inferior: "autonomy" }],
        requested_semantics: "preferred",
      },
      theory: makeTheory({
        defeasible_rules: [
          { id: "d-a", antecedents: ["problem(current)", "support(option_a) @option:option_a @value:safety"], consequent: "select_option_a" },
          { id: "d-b", antecedents: ["problem(current)", "support(option_b) @option:option_b @value:autonomy"], consequent: "select_option_b" },
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
    expect(report.missingOptionTags).toEqual([])
    expect(report.taggedSelectionAtoms).toEqual([])
    expect(report.missingValueTags).toEqual([])
  })
})
