export type DeliberativeEntityType =
  | "Decision"
  | "PolicyBundle"
  | "Consequence"
  | "Benefit"
  | "Burden"
  | "Mitigation"
  | "Compensation"
  | "Override"
  | "Guardrail"
  | "Trigger"
  | "RepairAction"
  | "StructuralConstraint"
  | "InfoEvent"
  | "Slot"
  | "DomainModule"
  | "WorldStatus"
  | "FrameworkStatus"
  | "ImplementationStatus"

export type DeliberativeRelation =
  | "supports"
  | "attacks"
  | "causes"
  | "enables"
  | "prevents"
  | "risks"
  | "mitigates"
  | "compensates"
  | "overrides"
  | "guardrails"
  | "invalidates"
  | "repairs"
  | "requires"
  | "belongs_to_slot"
  | "composable_with"
  | "mutually_exclusive"
  | "feasible"
  | "implementation_safe"
  | "auto_repairable"
  | "manual_review_required"
  | "info_event_imminent"
  | "recourse_value_high"

export type WorldStatus =
  | "world_established"
  | "world_plausible"
  | "world_residually_uncertain"
  | "world_not_fully_quantified"
  | "world_requires_manual_verification"

export type FrameworkStatus =
  | "framework_accepted"
  | "framework_rejected"
  | "framework_undecided"
  | "framework_conflicted"

export type ImplementationStatus =
  | "implementation_safe"
  | "implementation_unsafe"
  | "needs_review"

export type ExtendedPolicyStatus =
  | "core_accepted_selectable"
  | "core_accepted_conditioned"
  | "core_accepted_adaptive"
  | "core_accepted_but_infeasible"
  | "core_accepted_but_implementation_unsafe"
  | "selected_bundle"
  | "selected_bundle_with_residuals"
  | "under_modeled_selected_policy"
  | "justified_despite_burden"
  | "partially_mitigated_not_removed"
  | "compensated_but_not_eliminated"
  | "manual_review_required"
  | "residual_non_eliminable"

export interface DeliberativeTriple {
  left: string
  relation: DeliberativeRelation
  right: string
}
