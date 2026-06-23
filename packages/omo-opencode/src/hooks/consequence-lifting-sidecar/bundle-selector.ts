import { comparePolicies } from "./dominance-comparator-v2"
import type { BundleSelection, PolicyBundle } from "./policy-bundle-types"
import type { QualifiedPolicy } from "./types"

function violatesConstraint(selected: Set<string>, candidate: string, bundle: PolicyBundle): boolean {
  return bundle.constraints.some((constraint) => {
    if (constraint.kind === "mutually_exclusive") {
      return (constraint.left === candidate && selected.has(constraint.right)) || (constraint.right === candidate && selected.has(constraint.left))
    }
    if (constraint.kind === "requires") {
      return constraint.left === candidate && !selected.has(constraint.right)
    }
    if (constraint.kind === "composable_with") {
      return constraint.left === candidate && selected.size > 0 && !selected.has(constraint.right)
    }
    return false
  })
}

export function selectPolicyBundle(bundle: PolicyBundle, policies: QualifiedPolicy[]): BundleSelection {
  const byDecision = new Map(policies.map((policy) => [policy.primaryDecision, policy]))
  const selected = new Set<string>()
  const selectedBySlot: Record<string, string[]> = {}
  const excluded: Array<{ decision: string; reason: string }> = []

  for (const slot of bundle.slots) {
    const candidates = slot.candidates
      .map((decision) => byDecision.get(decision))
      .filter((policy): policy is QualifiedPolicy => policy !== undefined)
      .filter((policy) => policy.profile.policyStatus !== "core_accepted_blocked" && policy.profile.policyStatus !== "core_rejected")
      .sort((left, right) => {
        const verdict = comparePolicies(left, right)
        if (verdict.winner === "left") return -1
        if (verdict.winner === "right") return 1
        return 0
      })

    const slotSelected: string[] = []
    for (const policy of candidates) {
      if (slotSelected.length >= slot.maxSelectable) {
        excluded.push({ decision: policy.primaryDecision, reason: "not selected in slot" })
        continue
      }
      if (violatesConstraint(selected, policy.primaryDecision, bundle)) {
        excluded.push({ decision: policy.primaryDecision, reason: "blocked by bundle constraint" })
        continue
      }
      selected.add(policy.primaryDecision)
      slotSelected.push(policy.primaryDecision)
    }
    selectedBySlot[slot.name] = slotSelected
  }

  for (const policy of policies) {
    if (selected.has(policy.primaryDecision)) continue
    if (excluded.some((entry) => entry.decision === policy.primaryDecision)) continue
    excluded.push({ decision: policy.primaryDecision, reason: "not selected in bundle" })
  }

  return { selectedBySlot, excluded }
}
