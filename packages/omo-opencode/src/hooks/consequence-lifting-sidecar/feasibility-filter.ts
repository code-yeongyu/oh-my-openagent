import type { DecisionProfile, DecisionSlot, QualifiedPolicy } from "./types"
import { comparePolicies } from "./dominance-comparator-v2"

export function createDecisionSlot(slotName: string, candidates: string[], maxSelectable: number): DecisionSlot {
  return { name: slotName, candidates, maxSelectable }
}

export function filterByFeasibility(
  decisions: string[],
  constraints: Array<{ decision: string; feasible: boolean; reason: string }>,
): Map<string, { feasible: boolean; reason: string }> {
  const byDecision = new Map(constraints.map((constraint) => [constraint.decision, constraint]))
  return new Map(decisions.map((decision) => [decision, byDecision.get(decision) ?? { feasible: true, reason: "no blocking constraint" }]))
}

function rankStatus(status: DecisionProfile["policyStatus"]): number {
  switch (status) {
    case "core_accepted_selectable": return 0
    case "core_accepted_burdened": return 1
    case "core_accepted_conditioned": return 2
    default: return 3
  }
}

export function selectFromSlot(
  slot: DecisionSlot,
  profiles: Map<string, DecisionProfile>,
  policies?: QualifiedPolicy[],
): { selected: string | null; excluded: Array<{ decision: string; reason: string }> } {
  const policyByDecision = new Map((policies ?? []).map((policy) => [policy.primaryDecision, policy]))
  const ranked = slot.candidates
    .map((candidate) => profiles.get(candidate))
    .filter((profile): profile is DecisionProfile => {
      if (!profile) return false
      return profile.policyStatus !== "core_accepted_blocked" && profile.policyStatus !== "core_rejected"
    })
    .sort((left, right) => {
      const leftPolicy = policyByDecision.get(left.decision)
      const rightPolicy = policyByDecision.get(right.decision)
      if (leftPolicy && rightPolicy) {
        const verdict = comparePolicies(leftPolicy, rightPolicy)
        if (verdict.winner === "left") return -1
        if (verdict.winner === "right") return 1
      }
      return rankStatus(left.policyStatus) - rankStatus(right.policyStatus) || right.coreCombined - left.coreCombined
    })

  const selectedProfiles = ranked.slice(0, slot.maxSelectable)
  const selected = selectedProfiles[0]?.decision ?? null
  const excluded = slot.candidates
    .filter((candidate) => !selectedProfiles.some((profile) => profile.decision === candidate))
    .map((decision) => ({ decision, reason: profiles.get(decision)?.policyStatus === "core_accepted_blocked" ? "blocked by policy status" : "not selected in slot" }))

  return { selected, excluded }
}
