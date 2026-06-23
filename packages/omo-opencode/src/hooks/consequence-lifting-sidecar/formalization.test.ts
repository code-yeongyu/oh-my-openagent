import { describe, expect, it } from "bun:test"

import { deriveDeliberativeTriples, deriveExtendedPolicyStatus, deriveFrameworkStatus, deriveImplementationStatus, deriveWorldStatus } from "./formalization"
import type { QualifiedPolicy } from "./types"

function policy(overrides?: Partial<QualifiedPolicy>): QualifiedPolicy {
  return {
    primaryDecision: "activate_epr7_full_city",
    requiredConditions: ["mandatory_full_disclosure"],
    requiredMitigations: ["continuous_monitoring_pregnant_mandatory"],
    profile: {
      decision: "activate_epr7_full_city",
      coreStatus: "accepted",
      coreCombined: 0.72,
      framework_certainty: "medium",
      world_certainty: "low",
      catastrophicGated: false,
      forwardBurdens: [{ conclusion: "consent_principle_violated", liftStrength: "strong_lift", epistemicState: "established", normativeTag: "ethics:no_involuntary_exposure_without_consent", mitigationStatus: "partially_mitigated", mitigatedBy: ["necessity_override", "compensation_borgo_ferro"] }],
      forwardBenefits: [{ conclusion: "-certain_preventable_deaths", liftStrength: "strong_lift", epistemicState: "established", normativeTag: "value:preservation_of_life" }],
      mitigations: [],
      requiredConditions: ["mandatory_full_disclosure"],
      policyStatus: "core_accepted_conditioned",
      qualifiers: ["giustificabile_in_stato_di_necessita", "normativamente_burdened"],
    },
    alternativesConsidered: [],
    residualRisks: ["institutional_trust_collapse"],
    implementationSafety: { status: "implementationUnsafe", violations: [] },
    ...overrides,
  }
}

describe("formalization helpers", () => {
  it("derives framework/world/implementation statuses", () => {
    const p = policy()
    expect(deriveFrameworkStatus(p)).toBe("framework_accepted")
    expect(deriveWorldStatus(p)).toBe("world_not_fully_quantified")
    expect(deriveImplementationStatus(p.implementationSafety)).toBe("implementation_unsafe")
  })

  it("derives extended policy statuses and explicit triples", () => {
    const p = policy()
    expect(deriveExtendedPolicyStatus(p, undefined)).toBe("core_accepted_but_implementation_unsafe")
    const triples = deriveDeliberativeTriples(p)
    expect(triples.some((triple) => triple.relation === "risks" && triple.right === "consent_principle_violated")).toBe(true)
    expect(triples.some((triple) => triple.relation === "overrides" && triple.left === "necessity_override")).toBe(true)
    expect(triples.some((triple) => triple.relation === "compensates" && triple.left === "compensation_borgo_ferro")).toBe(true)
  })
})
