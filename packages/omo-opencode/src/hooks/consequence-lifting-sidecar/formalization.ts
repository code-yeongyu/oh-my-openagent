import type { PolicyCompletenessResult } from "./completeness-types"
import type { ImplementationSafetyValidation } from "./safety-validation-types"
import type { QualifiedPolicy } from "./types"
import type { DeliberativeTriple, ExtendedPolicyStatus, FrameworkStatus, ImplementationStatus, WorldStatus } from "./formalization-types"

export function deriveFrameworkStatus(policy: QualifiedPolicy): FrameworkStatus {
  if (policy.profile.coreStatus === "accepted") return "framework_accepted"
  if (policy.profile.coreStatus === "rejected") return "framework_rejected"
  return "framework_undecided"
}

export function deriveWorldStatus(policy: QualifiedPolicy): WorldStatus {
  if (policy.profile.world_certainty === "high") return "world_established"
  if (policy.profile.world_certainty === "medium") return policy.residualRisks.length > 0 ? "world_residually_uncertain" : "world_plausible"
  if (policy.profile.world_certainty === "low") return "world_not_fully_quantified"
  return "world_requires_manual_verification"
}

export function deriveImplementationStatus(validation: ImplementationSafetyValidation | undefined): ImplementationStatus {
  if (!validation) return "needs_review"
  return validation.status === "implementationSafe" ? "implementation_safe" : "implementation_unsafe"
}

export function deriveExtendedPolicyStatus(
  policy: QualifiedPolicy,
  completeness: PolicyCompletenessResult | undefined,
): ExtendedPolicyStatus {
  if (completeness?.gaps.some((gap) => gap.code === "under_modeled_selected_policy")) return "under_modeled_selected_policy"
  if (policy.implementationSafety?.status === "implementationUnsafe") return "core_accepted_but_implementation_unsafe"
  if (policy.profile.policyStatus === "core_accepted_blocked" && policy.profile.qualifiers.includes("non_selezionabile_infeasible")) return "core_accepted_but_infeasible"
  if (policy.profile.qualifiers.includes("giustificabile_in_stato_di_necessita") && policy.profile.forwardBurdens.length > 0) return "justified_despite_burden"
  if (policy.profile.policyStatus === "core_accepted_conditioned" && policy.residualRisks.length > 0) return "selected_bundle_with_residuals"
  if (policy.profile.policyStatus === "core_accepted_selectable") return "selected_bundle"
  if (policy.profile.policyStatus === "core_accepted_conditioned") return "core_accepted_conditioned"
  return "residual_non_eliminable"
}

export function deriveDeliberativeTriples(policy: QualifiedPolicy): DeliberativeTriple[] {
  const triples: DeliberativeTriple[] = []
  for (const burden of policy.profile.forwardBurdens) {
    triples.push({ left: policy.primaryDecision, relation: "risks", right: burden.conclusion })
    for (const mitigation of burden.mitigatedBy) {
      const relation = mitigation.includes("compensation") ? "compensates" : mitigation.includes("override") || mitigation.includes("necessity") ? "overrides" : "mitigates"
      triples.push({ left: mitigation, relation, right: burden.conclusion })
    }
  }
  for (const benefit of policy.profile.forwardBenefits) {
    triples.push({ left: policy.primaryDecision, relation: "prevents", right: benefit.conclusion })
  }
  for (const condition of policy.requiredConditions) {
    triples.push({ left: policy.primaryDecision, relation: "requires", right: condition })
  }
  for (const mitigation of policy.requiredMitigations) {
    triples.push({ left: policy.primaryDecision, relation: "requires", right: mitigation })
  }
  return triples
}
