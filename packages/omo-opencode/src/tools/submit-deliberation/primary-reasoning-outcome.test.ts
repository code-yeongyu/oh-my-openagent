import { describe, expect, it, mock } from "bun:test"
import { resolvePrimaryReasoningOutcome } from "./primary-reasoning-outcome"

describe("resolvePrimaryReasoningOutcome", () => {
  describe("#given a theory with named defeasible rules", () => {
    describe("#when falling back to reason_argue", () => {
      it("#then preserves rule names for undercut targets", async () => {
        const argue = mock(async () => ({ result: { conclusions: {}, extensions: [] } }))

        await resolvePrimaryReasoningOutcome({
          client: {
            argue,
          } as never,
          theory: {
            premises: [{ formula: "problem(current)", kind: "ordinary" }],
            defeasible_rules: [{ id: "d1", name: "eligibility", antecedents: ["problem(current)"], consequent: "select_option_a" }],
            classical_negation: true,
          },
          requestedSemantics: "preferred",
          request: {
            id: "delib-1",
            timestamp: "2026-04-12T00:00:00.000Z",
            problem_statement: "Choose an option",
            options: ["Option A", "Option B"],
            constraints: [],
            preferences: [],
            requested_semantics: "preferred",
          },
        })

        expect(argue.mock.calls[0]?.[0]).toEqual({
          semantics: "preferred",
          theory: {
            premises: [{ formula: "problem(current)", kind: "ordinary" }],
            strict_rules: [],
            defeasible_rules: [{ id: "d1", name: "eligibility", antecedents: ["problem(current)"], consequent: "select_option_a" }],
            preferences: [],
            classical_negation: true,
          },
        })
      })
    })
  })

  describe("#given reason_solve returns argumentation conclusions", () => {
    it("#when proof_chain is present #then preserves it in the argue result", async () => {
      const solve = mock(async () => ({
        stop_signal: "done",
        argumentation_result: {
          conclusions: {
            "select(option_a)": {
              status: "Accepted",
              proof_chain: [
                { conclusion: "support(option_a)", from: [], rule_id: null, rule_kind: "ordinary" },
                {
                  conclusion: "select(option_a)",
                  from: ["support(option_a)"],
                  rule_id: "d1",
                  rule_kind: "defeasible",
                },
              ],
            },
          },
        },
        constraint_state: {
          domains: {},
          solved: true,
          solved_count: 1,
          total_count: 1,
        },
        iterations_used: 1,
        reasoning_trace: [],
      }))

      const result = await resolvePrimaryReasoningOutcome({
        client: { solve } as never,
        theory: {
          premises: [{ formula: "support(option_a)", kind: "ordinary" }],
          strict_rules: [],
          defeasible_rules: [{ id: "d1", antecedents: ["support(option_a)"], consequent: "select(option_a)" }],
          preferences: [],
          classical_negation: true,
        },
        requestedSemantics: "preferred",
        request: {
          id: "delib-2",
          timestamp: "2026-04-12T00:00:00.000Z",
          problem_statement: "Choose an option",
          options: ["Option A", "Option B"],
          constraints: [],
          preferences: [],
          requested_semantics: "preferred",
        },
      })

      expect(result.argueResult).toMatchObject({
        conclusions: {
          "select(option_a)": {
            status: "Accepted",
            proof_chain: [
              { conclusion: "support(option_a)", from: [], rule_id: null, rule_kind: "ordinary" },
              {
                conclusion: "select(option_a)",
                from: ["support(option_a)"],
                rule_id: "d1",
                rule_kind: "defeasible",
              },
            ],
          },
        },
      })
    })

    it("#when proof_chain is absent #then defaults it to an empty array", async () => {
      const solve = mock(async () => ({
        stop_signal: "done",
        argumentation_result: {
          conclusions: {
            "select(option_b)": {
              status: "Undecided",
            },
          },
        },
        constraint_state: {
          domains: {},
          solved: true,
          solved_count: 1,
          total_count: 1,
        },
        iterations_used: 1,
        reasoning_trace: [],
      }))

      const result = await resolvePrimaryReasoningOutcome({
        client: { solve } as never,
        theory: {
          premises: [{ formula: "support(option_b)", kind: "ordinary" }],
          strict_rules: [],
          defeasible_rules: [{ id: "d2", antecedents: ["support(option_b)"], consequent: "select(option_b)" }],
          preferences: [],
          classical_negation: true,
        },
        requestedSemantics: "preferred",
        request: {
          id: "delib-3",
          timestamp: "2026-04-12T00:00:00.000Z",
          problem_statement: "Choose an option",
          options: ["Option A", "Option B"],
          constraints: [],
          preferences: [],
          requested_semantics: "preferred",
        },
      })

      expect(result.argueResult).toMatchObject({
        conclusions: {
          "select(option_b)": {
            status: "Undecided",
            proof_chain: [],
          },
        },
      })
    })
  })
})
