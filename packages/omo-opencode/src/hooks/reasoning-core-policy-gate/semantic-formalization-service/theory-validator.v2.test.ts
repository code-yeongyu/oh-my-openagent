import { describe, expect, it } from "bun:test"
import { FormalizationError } from "./errors"
import { createTheoryValidator } from "./theory-validator"
import type { Theory } from "./types"

type TheoryInvalidDetails = {
  violation: string
}

function isTheoryInvalidDetails(value: unknown): value is TheoryInvalidDetails {
  return typeof value === "object" && value !== null && "violation" in value
}

function createLogger() {
  return {
    warn(_msg: string, _meta?: Record<string, unknown>) {},
  }
}

function expectTheoryInvalid(
  action: () => Theory,
  expectedViolation: TheoryInvalidDetails["violation"],
) {
  try {
    action()
    throw new Error("Expected validate to throw")
  } catch (error) {
    expect(error instanceof FormalizationError).toBe(true)
    if (!(error instanceof FormalizationError)) {
      return
    }

    expect(error.code).toBe("theory_invalid")
    expect(isTheoryInvalidDetails(error.details)).toBe(true)
    if (!isTheoryInvalidDetails(error.details)) {
      return
    }

    expect(error.details.violation).toBe(expectedViolation)
  }
}

describe("createTheoryValidator v2 rules", () => {
  it("rejects premise kinds outside the supported enum when kind is present", () => {
    const theory = {
      premises: [{ formula: "problem(current)", kind: "unsupported_kind" }],
      defeasible_rules: [{ id: "d-0", antecedents: ["problem(current)"], consequent: "select_option_a" }],
      classical_negation: true,
    } as unknown as Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expectTheoryInvalid(() => validator.validate(theory), "invalid_premise_kind")
  })

  it("allows premise kind to be omitted for backward compatibility", () => {
    const theory = {
      premises: [{ formula: "problem(current)" }],
      defeasible_rules: [{ id: "d-0", antecedents: ["problem(current)"], consequent: "select_option_a" }],
      classical_negation: true,
    } as Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expect(validator.validate(theory, ["select_option_a"])).toBe(theory)
  })

  it("rejects contraries that duplicate classical negation contradictories", () => {
    const theory = {
      premises: [{ formula: "eligible(option_a)", kind: "ordinary" }],
      contraries: [["eligible(option_a)", "-eligible(option_a)"]],
      classical_negation: true,
    } satisfies Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expectTheoryInvalid(() => validator.validate(theory), "contrary_overlaps_classical_negation")
  })

  it("rejects preference groups with fewer than two elements", () => {
    const theory = {
      premises: [{ formula: "problem(current)", kind: "ordinary" }],
      defeasible_rules: [{ id: "d-0", antecedents: ["problem(current)"], consequent: "select_option_a" }],
      preferences: {
        groups: [{ group_id: "g-0", ordered_rules: ["d-0"], relation_to_other_groups: "unordered" }],
      },
      classical_negation: true,
    } satisfies Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expectTheoryInvalid(() => validator.validate(theory), "invalid_preference_group_size")
  })

  it("rejects preference groups that reference unknown rule ids or formulas", () => {
    const theory = {
      premises: [{ formula: "problem(current)", kind: "ordinary" }],
      defeasible_rules: [{ id: "d-0", antecedents: ["problem(current)"], consequent: "select_option_a" }],
      preferences: {
        groups: [
          {
            group_id: "g-0",
            ordered_rules: ["d-0", "missing_reference"],
            relation_to_other_groups: "unordered",
          },
        ],
      },
      classical_negation: true,
    } satisfies Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expectTheoryInvalid(() => validator.validate(theory), "invalid_preference_group_references")
  })

  it("rejects duplicate preference group elements across groups", () => {
    const theory = {
      premises: [{ formula: "problem(current)", kind: "ordinary" }],
      defeasible_rules: [
        { id: "d-0", antecedents: ["problem(current)"], consequent: "support(option_a)" },
        { id: "d-1", antecedents: ["problem(current)"], consequent: "select_option_a" },
      ],
      preferences: {
        groups: [
          { group_id: "g-0", ordered_rules: ["d-0", "d-1"], relation_to_other_groups: "unordered" },
          {
            group_id: "g-1",
            ordered_rules: ["d-1", "support(option_a)"],
            relation_to_other_groups: "unordered",
          },
        ],
      },
      classical_negation: true,
    } satisfies Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expectTheoryInvalid(() => validator.validate(theory), "duplicate_preference_group_elements")
  })

  it("rejects invalid @value tag formats on premises and rules", () => {
    const theory = {
      premises: [{ formula: "problem(current) @value:cost efficiency", kind: "ordinary" }],
      defeasible_rules: [
        {
          id: "d-0",
          antecedents: ["problem(current) @value:cost efficiency"],
          consequent: "select_option_a @value:cost efficiency",
        },
      ],
      classical_negation: true,
    } satisfies Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expectTheoryInvalid(() => validator.validate(theory), "invalid_value_tag_format")
  })

  it("accepts valid contraries, structured preference groups, and @value tags", () => {
    const theory = {
      premises: [
        { formula: "patient(case_1) @value:safety", kind: "axiom" },
        { formula: "resource_ready(case_1)", kind: "assumption" },
      ],
      strict_rules: [
        {
          id: "s-0",
          antecedents: ["patient(case_1) @value:safety"],
          consequent: "eligible(option_a)",
        },
      ],
      defeasible_rules: [
        {
          id: "d-0",
          antecedents: ["eligible(option_a)", "resource_ready(case_1)"],
          consequent: "select_option_a @value:cost_efficiency",
        },
      ],
      contraries: [["patient(case_1) @value:safety", "select_option_a @value:cost_efficiency"]],
      preferences: {
        pairwise: [{ superior: "d-0", inferior: "eligible(option_a)" }],
        groups: [
          {
            group_id: "g-formulas",
            ordered_rules: ["patient(case_1) @value:safety", "eligible(option_a)"],
            relation_to_other_groups: "unordered",
          },
          {
            group_id: "g-rules",
            ordered_rules: ["s-0", "d-0"],
            relation_to_other_groups: "unordered",
          },
        ],
      },
      classical_negation: true,
    } satisfies Theory
    const validator = createTheoryValidator({ logger: createLogger() })

    expect(validator.validate(theory, ["select_option_a @value:cost_efficiency"])).toBe(theory)
  })
})
