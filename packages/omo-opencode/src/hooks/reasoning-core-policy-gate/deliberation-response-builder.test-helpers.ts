import type { DeliberationRequest } from "../../agents/themis/types"
import type { SidecarOutput } from "../consequence-lifting-sidecar"

export function createRequest(requestedSemantics: DeliberationRequest["requested_semantics"] = "preferred"): DeliberationRequest {
  return {
    id: "delib-response-builder",
    timestamp: "2026-04-11T00:00:00.000Z",
    problem_statement: "Choose one option",
    options: ["Option A", "Option B", "Option C"],
    constraints: [],
    preferences: [],
    requested_semantics: requestedSemantics,
  }
}

export function createPolicy(primaryDecision: string, coreCombined = 0.8) {
  return {
    primaryDecision,
    requiredConditions: [],
    requiredMitigations: [],
    alternativesConsidered: [],
    residualRisks: [],
    profile: {
      decision: primaryDecision,
      coreStatus: "accepted" as const,
      coreCombined,
      forwardBurdens: [],
      forwardBenefits: [],
      mitigations: [],
      requiredConditions: [],
      policyStatus: "core_accepted_selectable" as const,
      qualifiers: [],
      framework_certainty: "high" as const,
      world_certainty: "high" as const,
      catastrophicGated: false,
    },
    completeness: { status: "complete" as const, targetDecision: primaryDecision, gaps: [], justifiedOmissions: [] },
    implementationSafety: { status: "implementationSafe" as const, violations: [] },
  }
}

export function createSidecar(selectedBySlot: Record<string, string[]>, policies = Object.values(selectedBySlot).flat().map((decision) => createPolicy(decision))): SidecarOutput {
  return {
    policies,
    profiles: [],
    graph: { decisions: policies.map((policy) => policy.primaryDecision), edges: [] },
    bundle: {
      bundle: { slots: [], constraints: [] },
      selection: { selectedBySlot, excluded: [] },
    },
    catastrophic: { classifications: [] },
    contamination: { results: [] },
    humility: {
      report: {
        capacity: "repairable",
        escalationReasons: [],
        summary: "Sidecar summary.",
      },
    },
  }
}
