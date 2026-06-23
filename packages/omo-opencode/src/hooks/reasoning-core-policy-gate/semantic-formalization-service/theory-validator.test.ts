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

describe("createTheoryValidator", () => {
  describe("#given theory with dangling antecedent", () => {
    it("#when validate #then throws theory_invalid violation dangling_antecedents", () => {
      const theory = {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        strict_rules: [{ id: "s-0", antecedents: ["unknown_atom"], consequent: "support(option_a)" }],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expectTheoryInvalid(() => validator.validate(theory), "dangling_antecedents")
    })
  })

  describe("#given theory with duplicate rule IDs", () => {
    it("#when validate #then throws theory_invalid violation duplicate_rule_ids", () => {
      const theory = {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        strict_rules: [{ id: "d-0", antecedents: ["problem(current)"], consequent: "support(option_a)" }],
        defeasible_rules: [{ id: "d-0", antecedents: ["support(option_a)"], consequent: "select_option_a" }],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expectTheoryInvalid(() => validator.validate(theory), "duplicate_rule_ids")
    })
  })

  describe("#given theory with preference referencing nonexistent rule ID", () => {
    it("#when validate #then throws theory_invalid violation invalid_preference_references", () => {
      const theory = {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        defeasible_rules: [{ id: "d-0", antecedents: ["problem(current)"], consequent: "select_option_a" }],
        preferences: [{ superior: "missing-rule", inferior: "d-0" }],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expectTheoryInvalid(() => validator.validate(theory), "invalid_preference_references")
    })
  })

  describe("#given theory with empty-string premise formula", () => {
    it("#when validate #then throws theory_invalid violation non_atomic_premises", () => {
      const theory = {
        premises: [{ formula: "", kind: "ordinary" }],
        defeasible_rules: [{ id: "d-0", antecedents: [], consequent: "select_option_a" }],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expectTheoryInvalid(() => validator.validate(theory), "non_atomic_premises")
    })
  })

  describe("#given theory with contrary referencing nonexistent formula", () => {
    it("#when validate #then throws theory_invalid violation invalid_contrary_references", () => {
      const theory = {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        strict_rules: [{ id: "s-0", antecedents: ["problem(current)"], consequent: "eligible(option_a)" }],
        contraries: [["problem(current)", "missing_formula"]],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expectTheoryInvalid(() => validator.validate(theory), "invalid_contrary_references")
    })
  })

  describe("#given theory with self-contrary pair", () => {
    it("#when validate #then throws theory_invalid violation self_contrary", () => {
      const theory = {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        strict_rules: [{ id: "s-0", antecedents: ["problem(current)"], consequent: "eligible(option_a)" }],
        contraries: [["eligible(option_a)", "eligible(option_a)"]],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expectTheoryInvalid(() => validator.validate(theory), "self_contrary")
    })
  })

  describe("#given theory where declared option atom has no rule consequent", () => {
    it("#when validate #then throws theory_invalid violation unreachable_option_atoms", () => {
      const theory = {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        defeasible_rules: [{ id: "d-0", antecedents: ["problem(current)"], consequent: "support(option_a)" }],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expectTheoryInvalid(
        () => validator.validate(theory, ["select_option_a"]),
        "unreachable_option_atoms",
      )
    })
  })

  describe("#given well-formed theory satisfying all 5 conditions", () => {
    it("#when validate #then returns the theory unchanged", () => {
      const theory = {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        strict_rules: [{ id: "s-0", antecedents: ["problem(current)"], consequent: "eligible(option_a)" }],
        defeasible_rules: [{ id: "d-0", antecedents: ["eligible(option_a)"], consequent: "select_option_a" }],
        preferences: [{ superior: "d-0", inferior: "s-0" }],
        contraries: [["problem(current)", "select_option_a"]],
        classical_negation: true,
      } satisfies Theory
      const validator = createTheoryValidator({ logger: createLogger() })

      expect(validator.validate(theory, ["select_option_a"])).toBe(theory)
    })
  })
})
