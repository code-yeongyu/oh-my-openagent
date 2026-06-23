import type { PolicyCompletenessResult } from "./completeness-types"
import type { ImplementationSafetyValidation } from "./safety-validation-types"
import type { DecisionProfile, QualifiedPolicy } from "./types"
import type { DominanceReason, DominanceVerdict } from "./dominance-types"

function compareNumbers(left: number, right: number): -1 | 0 | 1 {
  if (left === right) return 0
  return left > right ? 1 : -1
}

function comparePolicyStatus(left: DecisionProfile["policyStatus"], right: DecisionProfile["policyStatus"]): -1 | 0 | 1 {
  const rank: Record<DecisionProfile["policyStatus"], number> = {
    core_accepted_selectable: 4,
    core_accepted_burdened: 3,
    core_accepted_conditioned: 2,
    core_accepted_blocked: 1,
    core_rejected: 0,
  }
  return compareNumbers(rank[left], rank[right])
}

function compareSafety(left: ImplementationSafetyValidation | undefined, right: ImplementationSafetyValidation | undefined): -1 | 0 | 1 {
  const rank = (value: ImplementationSafetyValidation | undefined) => value?.status === "implementationSafe" ? 1 : 0
  return compareNumbers(rank(left), rank(right))
}

function compareCompleteness(left: PolicyCompletenessResult | undefined, right: PolicyCompletenessResult | undefined): -1 | 0 | 1 {
  const score = (value: PolicyCompletenessResult | undefined) => {
    if (!value) return 1
    if (value.status === "complete") return 1
    return value.gaps.some((gap) => gap.severity === "critical") ? 0 : 0.5
  }
  return compareNumbers(score(left), score(right))
}

function countStrongBurdens(policy: QualifiedPolicy): number {
  return policy.profile.forwardBurdens.filter((burden) => burden.liftStrength === "strong_lift").length
}

function countStrongBenefits(policy: QualifiedPolicy): number {
  return policy.profile.forwardBenefits.filter((benefit) => benefit.liftStrength === "strong_lift").length
}

function certaintyScore(policy: QualifiedPolicy): number {
  const map = { high: 1, medium: 0.5, low: 0.2 }
  const framework = policy.profile.framework_certainty ? map[policy.profile.framework_certainty] : 0
  const world = policy.profile.world_certainty ? map[policy.profile.world_certainty] : 0
  return framework + world
}

export function comparePolicies(left: QualifiedPolicy, right: QualifiedPolicy): DominanceVerdict {
  const reasons: DominanceReason[] = []
  const checks: Array<[string, -1 | 0 | 1]> = [
    ["policy_status", comparePolicyStatus(left.profile.policyStatus, right.profile.policyStatus)],
    ["implementation_safety", compareSafety(left.implementationSafety, right.implementationSafety)],
    ["completeness", compareCompleteness(left.completeness, right.completeness)],
    ["catastrophic_gate", compareNumbers(left.profile.catastrophicGated ? 0 : 1, right.profile.catastrophicGated ? 0 : 1)],
    ["strong_burden_count", compareNumbers(countStrongBurdens(right), countStrongBurdens(left))],
    ["strong_benefit_count", compareNumbers(countStrongBenefits(left), countStrongBenefits(right))],
    ["certainty_split", compareNumbers(certaintyScore(left), certaintyScore(right))],
    ["core_combined", compareNumbers(left.profile.coreCombined, right.profile.coreCombined)],
  ]

  for (const [criterion, result] of checks) {
    if (result === 0) continue
    const winner = result > 0 ? "left" : "right"
    reasons.push({ criterion, winner })
    return { winner, reasons }
  }

  return { winner: "tie", reasons }
}
