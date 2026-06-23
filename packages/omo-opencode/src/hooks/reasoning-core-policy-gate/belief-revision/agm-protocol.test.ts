import { describe, expect, it, mock } from "bun:test"
import { runAgmBeliefRevisionProtocol, type AgmRevisionTheory } from "./agm-protocol"

const BASE_THEORY: AgmRevisionTheory = {
  premises: [
    { formula: "policy_required", kind: "axiom" },
    { formula: "context_known", kind: "ordinary" },
    { formula: "fallback_candidate", kind: "assumption" },
  ],
  strict_rules: [],
  defeasible_rules: [],
  preferences: [],
  classical_negation: true,
}

describe("runAgmBeliefRevisionProtocol", () => {
  it("#when the rerun converges after contracting weaker premises #then returns converged_after_revision with revised premises", async () => {
    const reRun = mock(async (theory: AgmRevisionTheory) => {
      const remainingPremises = theory.premises.map((premise) => premise.formula)
      if (remainingPremises.includes("context_known")) {
        return { verdict: "unable_to_converge" as const }
      }

      return {
        verdict: "selected" as const,
        rationale: "Recovered after revision.",
        bundle: { selected_option: "Option A", burdens: [], mitigations: [], guardrails: [] },
      }
    })

    const result = await runAgmBeliefRevisionProtocol({
      theory: BASE_THEORY,
      failingVerdict: "unable_to_converge",
      reRun,
    })

    expect(reRun).toHaveBeenCalledTimes(2)
    expect(reRun.mock.calls[0]?.[0].premises.map((premise: { formula: string }) => premise.formula)).toEqual([
      "policy_required",
      "context_known",
    ])
    expect(reRun.mock.calls[1]?.[0].premises.map((premise: { formula: string }) => premise.formula)).toEqual([
      "policy_required",
    ])
    expect(result).toEqual({
      rationale: "Recovered after revision.",
      bundle: { selected_option: "Option A", burdens: [], mitigations: [], guardrails: [] },
      verdict: "converged_after_revision",
      revised_premises: ["fallback_candidate", "context_known"],
      revised_theory: {
        ...BASE_THEORY,
        premises: [{ formula: "policy_required", kind: "axiom" }],
      },
    })
  })

  it("#when every rerun still fails #then stops after three cycles and returns null", async () => {
    const reRun = mock(async () => ({ verdict: "no_selectable_bundle" as const }))

    const result = await runAgmBeliefRevisionProtocol({
      theory: {
        ...BASE_THEORY,
        premises: [
          { formula: "policy_required", kind: "axiom" },
          { formula: "context_known", kind: "ordinary" },
          { formula: "fallback_candidate", kind: "assumption" },
          { formula: "backup_candidate", kind: "assumption" },
        ],
      },
      failingVerdict: "no_selectable_bundle",
      reRun,
    })

    expect(reRun).toHaveBeenCalledTimes(3)
    expect(result).toBeNull()
  })

  it("#when no contractible premise remains #then returns null without rerunning", async () => {
    const reRun = mock(async () => ({ verdict: "selected" as const }))

    const result = await runAgmBeliefRevisionProtocol({
      theory: {
        ...BASE_THEORY,
        premises: [{ formula: "policy_required", kind: "axiom" }],
      },
      failingVerdict: "unable_to_converge",
      reRun,
    })

    expect(reRun).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})
