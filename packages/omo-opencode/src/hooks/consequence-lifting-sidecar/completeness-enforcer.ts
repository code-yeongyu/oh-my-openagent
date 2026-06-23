import { classifyConclusion } from "./decision-registry"
import type { PolicyCompletenessResult } from "./completeness-types"
import type { ConsequenceGraph, DecisionSlot, QualifiedPolicy } from "./types"

interface CompletenessContext {
  graph: ConsequenceGraph
  slot: DecisionSlot | null
  policies: QualifiedPolicy[]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function createResult(targetDecision: string): PolicyCompletenessResult {
  return { status: "complete", targetDecision, gaps: [], justifiedOmissions: [] }
}

export function enforceSelectedPolicyCompleteness(
  selectedPolicy: QualifiedPolicy,
  context: CompletenessContext,
): PolicyCompletenessResult {
  const result = createResult(selectedPolicy.primaryDecision)
  const expectedConditions = unique(
    context.graph.edges
      .filter((edge) => edge.from === selectedPolicy.primaryDecision)
      .filter((edge) => classifyConclusion(edge.to, []) === "condition")
      .map((edge) => edge.to),
  )
  const representedConditions = new Set(selectedPolicy.requiredConditions)

  for (const condition of expectedConditions) {
    if (representedConditions.has(condition)) continue
    result.gaps.push({
      code: "missing_required_condition",
      severity: "high",
      subject: condition,
      message: `Selected policy omitted required condition ${condition}.`,
    })
  }

  const expectedMitigations = unique(
    selectedPolicy.profile.mitigations
      .filter((binding) => binding.required)
      .map((binding) => binding.mitigation),
  )
  const representedMitigations = new Set(selectedPolicy.requiredMitigations)

  for (const mitigation of expectedMitigations) {
    if (representedMitigations.has(mitigation)) continue
    result.gaps.push({
      code: "missing_required_mitigation",
      severity: "critical",
      subject: mitigation,
      message: `Selected policy omitted accepted required mitigation ${mitigation}.`,
    })
  }

  const hasAttributableConsequences = context.graph.edges.some(
    (edge) => edge.from === selectedPolicy.primaryDecision && edge.liftStrength !== "no_lift",
  )
  const hasForwardProfile = selectedPolicy.profile.forwardBurdens.length > 0 || selectedPolicy.profile.forwardBenefits.length > 0
  if (hasAttributableConsequences && !hasForwardProfile) {
    result.gaps.push({
      code: "under_modeled_selected_policy",
      severity: "critical",
      subject: selectedPolicy.primaryDecision,
      message: `Selected policy ${selectedPolicy.primaryDecision} has attributable consequences but no forward profile.`,
    })
  }

  if (context.slot) {
    const considered = new Set(selectedPolicy.alternativesConsidered.map((alternative) => alternative.decision))
    for (const candidate of context.slot.candidates) {
      if (candidate === selectedPolicy.primaryDecision || considered.has(candidate)) continue
      const alternative = context.policies.find((policy) => policy.primaryDecision === candidate)
      if (!alternative) continue
      if (alternative.profile.policyStatus === "core_accepted_blocked" || alternative.profile.policyStatus === "core_rejected") {
        result.justifiedOmissions.push({ decision: candidate, reason: "blocked_or_rejected_alternative" })
        continue
      }
      result.gaps.push({
        code: "missing_viable_alternative",
        severity: "high",
        subject: candidate,
        message: `Selected policy omitted viable alternative ${candidate}.`,
      })
    }
  }

  if (result.gaps.length > 0) result.status = "incomplete"
  return result
}
