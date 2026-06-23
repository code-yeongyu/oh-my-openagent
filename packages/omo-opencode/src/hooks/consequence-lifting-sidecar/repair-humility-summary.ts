import type { VOIResult } from "./voi-types"
import type { RepairEscalationReason, RepairHumilityContext } from "./repair-humility-types"

const HIGH_CONFIDENCE_THRESHOLD = 0.75
const MEDIUM_CONFIDENCE_THRESHOLD = 0.45

export function hasSelectedDecisionInGroundedSet(context: RepairHumilityContext): boolean {
  if (!context.selectedDecision || !context.semanticsComparison) return false
  return context.semanticsComparison.grounded_set.includes(context.selectedDecision)
}

export function hasSelectedDecisionInPreferredOnly(context: RepairHumilityContext): boolean {
  const selectedDecision = context.selectedDecision
  if (!selectedDecision || !context.semanticsComparison) return false
  if (hasSelectedDecisionInGroundedSet(context)) return false

  return context.semanticsComparison.preferred_extensions.some((extension) => extension.includes(selectedDecision))
    || context.semanticsComparison.certainty_gradient.defensible.includes(selectedDecision)
}

export function collectMissingSignals(context: RepairHumilityContext): string[] {
  const missing: string[] = []
  if (!context.semanticsComparison) missing.push("multi-semantics comparison")
  if (!context.confidence || (context.confidence.framework_certainty === undefined && context.confidence.world_certainty === undefined)) {
    missing.push("confidence scores")
  }
  if (!context.convergence) missing.push("convergence status")
  return missing
}

export function buildRepairHumilitySummary(
  reasons: RepairEscalationReason[],
  context: RepairHumilityContext,
  voi: VOIResult | undefined,
): string {
  const missingSignals = collectMissingSignals(context)
  if (reasons.length > 0) {
    return buildIssueSummary(reasons, context, voi, missingSignals)
  }
  if (missingSignals.length > 0) {
    return buildMissingSignalSummary(context, missingSignals)
  }
  return buildPositiveSummary(context)
}

function confidenceLabel(score: number | null | undefined): string | undefined {
  if (typeof score !== "number") return undefined
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return "high"
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium"
  return "low"
}

function formatList(values: string[]): string {
  if (values.length === 0) return ""
  if (values.length === 1) return values[0] ?? ""
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`
}

function buildPositiveSummary(context: RepairHumilityContext): string {
  const selectedDecision = context.selectedDecision ?? "the selected option"
  const framework = confidenceLabel(context.confidence?.framework_certainty)
  const world = confidenceLabel(context.confidence?.world_certainty)
  const descriptors = [
    "no preference cycles",
    framework ? `${framework} framework confidence` : undefined,
    world ? `${world} world confidence` : undefined,
    context.convergence === "converged" ? "converged reasoning" : undefined,
  ].filter((value): value is string => typeof value === "string")

  if (hasSelectedDecisionInGroundedSet(context) && descriptors.length >= 3 && !(context.revisedPremises?.length)) {
    return `Selected option ${selectedDecision} is in the grounded set with ${descriptors.slice(0, -1).join(", ")}, and ${descriptors[descriptors.length - 1]}. No revision needed.`
  }

  const suffix = context.revisedPremises?.length
    ? ` Premises were revised (${context.revisedPremises.length}), so verify the revised basis before acting.`
    : " No revision needed."
  return `No structural gaps are currently blocking repairability for ${selectedDecision}.${suffix}`
}

function buildMissingSignalSummary(context: RepairHumilityContext, missingSignals: string[]): string {
  const revisionNote = context.revisedPremises?.length
    ? ` Premises were revised (${context.revisedPremises.length}), so verify the revised basis before acting.`
    : ""
  return `No structural gaps are currently blocking repairability, but ${formatList(missingSignals)} were not provided.${revisionNote}`
}

function buildIssueSummary(
  reasons: RepairEscalationReason[],
  context: RepairHumilityContext,
  voi: VOIResult | undefined,
  missingSignals: string[],
): string {
  const sentences: string[] = []

  if (hasSelectedDecisionInPreferredOnly(context)) {
    sentences.push(
      `Selected option ${context.selectedDecision} is defensible in preferred semantics but not in the grounded set, so it remains contestable rather than certain.`,
    )
  }

  if (reasons.some((reason) => reason.code === "implementation_unsafe")) {
    sentences.push("Selected policy is not safely implementable with current guarantees.")
  }

  if (reasons.some((reason) => reason.code === "critical_completeness_gap")) {
    sentences.push("Critical completeness gaps require escalation.")
  } else if (reasons.some((reason) => reason.code === "completeness_gap")) {
    sentences.push("Policy remains structurally incomplete.")
  }

  if (context.preferenceCycleDetected) {
    const path = context.preferenceCyclePath?.length ? ` (${context.preferenceCyclePath.join(" -> ")})` : ""
    sentences.push(`Preference cycle detected${path}.`)
  }

  if (voi?.deferRecommended) {
    sentences.push("VOI suggests deferral.")
  }

  if (context.convergence === "looping") {
    sentences.push("Reasoning is looping.")
  }

  if (context.convergence === "not_converged") {
    sentences.push("Reasoning is not yet converged.")
  }

  if (context.convergence === "unable_to_converge") {
    sentences.push("Reasoning could not converge under the current constraints.")
  }

  if (missingSignals.length > 0) {
    sentences.push(`${formatList(missingSignals)} were not provided.`)
  }

  if (context.revisedPremises?.length) {
    sentences.push(`Premises were revised (${context.revisedPremises.length}), so verify the revised basis before acting.`)
  }

  return sentences.join(" ")
}
