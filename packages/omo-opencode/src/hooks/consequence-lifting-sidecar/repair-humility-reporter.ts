import type { PolicyCompletenessResult } from "./completeness-types"
import type { ImplementationSafetyValidation } from "./safety-validation-types"
import { buildRepairHumilitySummary, hasSelectedDecisionInPreferredOnly } from "./repair-humility-summary"
import type {
  HumilityReport,
  RepairCapacity,
  RepairEscalationReason,
  RepairHumilityContext,
} from "./repair-humility-types"
import type { VOIResult } from "./voi-types"

function collectStructuralReasons(context: RepairHumilityContext): RepairEscalationReason[] {
  const reasons: RepairEscalationReason[] = []

  if (hasSelectedDecisionInPreferredOnly(context)) {
    reasons.push({
      code: "selected_not_grounded",
      message: "Selected option is defensible under preferred semantics but not grounded",
    })
  }

  if (context.preferenceCycleDetected) {
    reasons.push({ code: "preference_cycle_detected", message: "Preference cycle detected in derived ordering" })
  }

  if (context.convergence === "looping") {
    reasons.push({ code: "convergence_looping", message: "Reasoning is looping instead of converging" })
  }

  if (context.convergence === "not_converged") {
    reasons.push({ code: "convergence_not_converged", message: "Reasoning did not converge" })
  }

  if (context.convergence === "unable_to_converge") {
    reasons.push({ code: "convergence_unable_to_converge", message: "Reasoning could not converge under current constraints" })
  }

  return reasons
}

function determineCapacity(reasons: RepairEscalationReason[], voi: VOIResult | undefined): RepairCapacity {
  const severeCodes = new Set(["implementation_unsafe", "critical_completeness_gap", "convergence_unable_to_converge"])
  let capacity: RepairCapacity = reasons.length > 0 ? "partially_repairable" : "repairable"

  if (reasons.some((reason) => severeCodes.has(reason.code))) {
    capacity = "partially_repairable"
  }

  return capacity === "partially_repairable" && voi?.deferRecommended ? "irreparable" : capacity
}

export function assessRepairHumility(
  completeness: PolicyCompletenessResult | undefined,
  implementationSafety: ImplementationSafetyValidation | undefined,
  voi: VOIResult | undefined,
  context: RepairHumilityContext = {},
): HumilityReport {
  const reasons: RepairEscalationReason[] = []

  if (implementationSafety?.status === "implementationUnsafe") {
    reasons.push({ code: "implementation_unsafe", message: "Selected policy is not safely implementable with current guarantees" })
  }

  if (completeness?.status === "incomplete") {
    const hasCriticalGap = completeness.gaps.some((gap) => gap.severity === "critical")
    reasons.push({
      code: hasCriticalGap ? "critical_completeness_gap" : "completeness_gap",
      message: hasCriticalGap ? "Critical completeness gaps require escalation" : "Policy remains structurally incomplete",
    })
  }

  if (voi?.deferRecommended) {
    reasons.push({ code: "high_voi_deferral", message: "Additional information has unusually high decision value before commitment" })
  }

  reasons.push(...collectStructuralReasons(context))
  const capacity = determineCapacity(reasons, voi)

  return {
    capacity,
    escalationReasons: reasons,
    summary: buildRepairHumilitySummary(reasons, context, voi),
  }
}
