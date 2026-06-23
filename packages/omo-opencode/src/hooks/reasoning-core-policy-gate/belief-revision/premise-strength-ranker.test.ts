import { describe, expect, it } from "bun:test"
import { selectWeakestPremise } from "./premise-strength-ranker"

describe("selectWeakestPremise", () => {
  it("#given assumptions ordinary and axioms #when selecting weakest premise #then chooses the first assumption", () => {
    const weakest = selectWeakestPremise([
      { formula: "policy_required", kind: "axiom" },
      { formula: "context_known", kind: "ordinary" },
      { formula: "fallback_candidate", kind: "assumption" },
      { formula: "backup_candidate", kind: "assumption" },
    ])

    expect(weakest).toEqual({
      index: 2,
      premise: { formula: "fallback_candidate", kind: "assumption" },
    })
  })

  it("#given no assumptions #when selecting weakest premise #then chooses the first ordinary premise", () => {
    const weakest = selectWeakestPremise([
      { formula: "policy_required", kind: "axiom" },
      { formula: "context_known", kind: "ordinary" },
      { formula: "risk_low", kind: "ordinary" },
    ])

    expect(weakest).toEqual({
      index: 1,
      premise: { formula: "context_known", kind: "ordinary" },
    })
  })

  it("#given only axioms #when selecting weakest premise #then returns null because axioms are never contracted", () => {
    expect(selectWeakestPremise([
      { formula: "policy_required", kind: "axiom" },
      { formula: "safety_guardrail", kind: "axiom" },
    ])).toBeNull()
  })
})
