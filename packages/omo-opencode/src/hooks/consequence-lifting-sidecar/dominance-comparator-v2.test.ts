import { describe, expect, it } from "bun:test"

import { comparePolicies } from "./dominance-comparator-v2"
import type { QualifiedPolicy } from "./types"

function policy(name: string, overrides?: Partial<QualifiedPolicy>): QualifiedPolicy {
  return {
    primaryDecision: name,
    requiredConditions: [],
    requiredMitigations: [],
    profile: {
      decision: name,
      coreStatus: "accepted",
      coreCombined: 0.7,
      framework_certainty: "medium",
      world_certainty: "medium",
      catastrophicGated: false,
      forwardBurdens: [],
      forwardBenefits: [],
      mitigations: [],
      requiredConditions: [],
      policyStatus: "core_accepted_selectable",
      qualifiers: [],
    },
    alternativesConsidered: [],
    residualRisks: [],
    ...overrides,
  }
}

describe("comparePolicies", () => {
  it("prefers selectable over conditioned policies", () => {
    const verdict = comparePolicies(policy("a"), policy("b", { profile: { ...policy("b").profile, policyStatus: "core_accepted_conditioned" } }))
    expect(verdict.winner).toBe("left")
    expect(verdict.reasons[0]?.criterion).toBe("policy_status")
  })

  it("prefers implementation safe policies", () => {
    const verdict = comparePolicies(policy("a", { implementationSafety: { status: "implementationSafe", violations: [] } }), policy("b", { implementationSafety: { status: "implementationUnsafe", violations: [] } }))
    expect(verdict.winner).toBe("left")
    expect(verdict.reasons[0]?.criterion).toBe("implementation_safety")
  })

  it("penalizes catastrophic-gated policies", () => {
    const verdict = comparePolicies(policy("a", { profile: { ...policy("a").profile, catastrophicGated: true } }), policy("b"))
    expect(verdict.winner).toBe("right")
  })

  it("falls back to core combined after higher layers tie", () => {
    const verdict = comparePolicies(policy("a", { profile: { ...policy("a").profile, coreCombined: 0.9 } }), policy("b", { profile: { ...policy("b").profile, coreCombined: 0.6 } }))
    expect(verdict.winner).toBe("left")
    expect(verdict.reasons[0]?.criterion).toBe("core_combined")
  })
})
