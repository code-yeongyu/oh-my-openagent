import { describe, expect, it } from "bun:test"
import { enforceSelectedPolicyCompleteness } from "./completeness-enforcer"
import type { ConsequenceGraph, DecisionSlot, DecisionProfile, QualifiedPolicy } from "./types"

function createProfile(overrides: Partial<DecisionProfile> = {}): DecisionProfile {
  return {
    decision: "select_primary_action",
    coreStatus: "accepted",
    coreCombined: 0.9,
    forwardBurdens: [
      {
        conclusion: "risk_patient_harm",
        liftStrength: "medium_lift",
        epistemicState: "established",
        normativeTag: "burden",
        mitigationStatus: "sufficiently_mitigated",
        mitigatedBy: ["require_patient_monitoring"],
      },
    ],
    forwardBenefits: [
      {
        conclusion: "protect_patient",
        liftStrength: "strong_lift",
        epistemicState: "established",
        normativeTag: "benefit",
      },
    ],
    mitigations: [
      {
        mitigation: "require_patient_monitoring",
        targetBurden: "risk_patient_harm",
        effectiveness: "sufficiently_mitigated",
        required: true,
      },
    ],
    requiredConditions: ["require_guardian_consent"],
    policyStatus: "core_accepted_conditioned",
    qualifiers: ["ammissibile_solo_se_condizionata"],
    ...overrides,
  }
}

function createPolicy(overrides: Partial<QualifiedPolicy> = {}): QualifiedPolicy {
  const profile = overrides.profile ?? createProfile()
  return {
    primaryDecision: profile.decision,
    requiredConditions: profile.requiredConditions,
    requiredMitigations: profile.mitigations.filter((binding) => binding.required).map((binding) => binding.mitigation),
    profile,
    alternativesConsidered: [{ decision: "secondary_action", reason: "alternative in decision slot" }],
    residualRisks: [],
    ...overrides,
  }
}

function createGraph(overrides: Partial<ConsequenceGraph> = {}): ConsequenceGraph {
  return {
    decisions: ["select_primary_action", "secondary_action", "blocked_action"],
    edges: [
      {
        from: "select_primary_action",
        to: "require_guardian_consent",
        relation: "enables",
        attribution: {
          directness: "direct",
          foreseeability: "high",
          controllability: "high",
          affectsVulnerable: false,
          horizon: "immediate",
        },
        liftStrength: "medium_lift",
      },
      {
        from: "select_primary_action",
        to: "risk_patient_harm",
        relation: "risks",
        attribution: {
          directness: "direct",
          foreseeability: "high",
          controllability: "partial",
          affectsVulnerable: true,
          horizon: "short",
        },
        liftStrength: "strong_lift",
      },
    ],
    ...overrides,
  }
}

const slot: DecisionSlot = { name: "primary_decision", candidates: ["select_primary_action", "secondary_action", "blocked_action"], maxSelectable: 1 }

describe("enforceSelectedPolicyCompleteness", () => {
  it("returns complete when the selected policy keeps required conditions, required mitigations, and viable alternatives", () => {
    const selectedPolicy = createPolicy()
    const complete = enforceSelectedPolicyCompleteness(selectedPolicy, {
      graph: createGraph(),
      slot,
      policies: [
        selectedPolicy,
        createPolicy({
          primaryDecision: "secondary_action",
          profile: createProfile({ decision: "secondary_action", policyStatus: "core_accepted_selectable", requiredConditions: [] }),
          requiredConditions: [],
          requiredMitigations: [],
          alternativesConsidered: [],
        }),
        createPolicy({
          primaryDecision: "blocked_action",
          profile: createProfile({ decision: "blocked_action", policyStatus: "core_accepted_blocked", requiredConditions: [], mitigations: [] }),
          requiredConditions: [],
          requiredMitigations: [],
          alternativesConsidered: [],
        }),
      ],
    })

    expect(complete.status).toBe("complete")
    expect(complete.gaps).toEqual([])
  })

  it("returns incomplete when required conditions or required mitigations are missing from the selected policy shape", () => {
    const incomplete = enforceSelectedPolicyCompleteness(createPolicy({ requiredConditions: [], requiredMitigations: [] }), {
      graph: createGraph(),
      slot,
      policies: [createPolicy({ requiredConditions: [], requiredMitigations: [] })],
    })

    expect(incomplete.status).toBe("incomplete")
    expect(incomplete.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_required_condition", severity: "high", subject: "require_guardian_consent" }),
        expect.objectContaining({ code: "missing_required_mitigation", severity: "critical", subject: "require_patient_monitoring" }),
      ]),
    )
  })

  it("treats omitted blocked or rejected alternatives as justified omissions instead of completeness gaps", () => {
    const selectedPolicy = createPolicy({ alternativesConsidered: [] })
    const result = enforceSelectedPolicyCompleteness(selectedPolicy, {
      graph: createGraph(),
      slot: { ...slot, candidates: ["select_primary_action", "blocked_action", "rejected_action"] },
      policies: [
        selectedPolicy,
        createPolicy({
          primaryDecision: "blocked_action",
          profile: createProfile({ decision: "blocked_action", policyStatus: "core_accepted_blocked", requiredConditions: [], mitigations: [] }),
          requiredConditions: [],
          requiredMitigations: [],
          alternativesConsidered: [],
        }),
        createPolicy({
          primaryDecision: "rejected_action",
          profile: createProfile({ decision: "rejected_action", policyStatus: "core_rejected", requiredConditions: [], mitigations: [] }),
          requiredConditions: [],
          requiredMitigations: [],
          alternativesConsidered: [],
        }),
      ],
    })

    expect(result.gaps).toEqual([])
    expect(result.justifiedOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision: "blocked_action", reason: "blocked_or_rejected_alternative" }),
        expect.objectContaining({ decision: "rejected_action", reason: "blocked_or_rejected_alternative" }),
      ]),
    )
  })

  it("marks the selected policy as under-modeled when attributable consequences exist but no forward profile was produced", () => {
    const result = enforceSelectedPolicyCompleteness(createPolicy({
      profile: createProfile({ forwardBurdens: [], forwardBenefits: [], mitigations: [] }),
      requiredMitigations: [],
    }), {
      graph: createGraph(),
      slot: null,
      policies: [],
    })

    expect(result.status).toBe("incomplete")
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "under_modeled_selected_policy", severity: "critical", subject: "select_primary_action" }),
      ]),
    )
  })
})
