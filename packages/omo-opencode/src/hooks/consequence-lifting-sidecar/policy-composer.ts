import type { DecisionProfile, DecisionSlot, PolicyQualifier, PolicyStatus, QualifiedPolicy } from "./types"

function hasRequiredMitigation(profile: Omit<DecisionProfile, "policyStatus" | "qualifiers">): boolean {
  return profile.mitigations.some((binding) => binding.required)
}

export function composePolicy(
  decision: string,
  profile: Omit<DecisionProfile, "policyStatus" | "qualifiers">,
  slot: DecisionSlot | null,
  feasible: boolean,
): QualifiedPolicy {
  let policyStatus: PolicyStatus = "core_accepted_selectable"
  if (profile.coreStatus === "rejected") {
    policyStatus = "core_rejected"
  } else if (profile.catastrophicGated) {
    policyStatus = "core_accepted_blocked"
  } else if (!feasible || profile.forwardBurdens.some((burden) => burden.liftStrength === "strong_lift" && burden.mitigationStatus === "unmitigated")) {
    policyStatus = "core_accepted_blocked"
  } else if (profile.forwardBurdens.some((burden) => burden.mitigationStatus !== "sufficiently_mitigated")) {
    policyStatus = "core_accepted_conditioned"
  } else if (profile.forwardBurdens.length > 0) {
    policyStatus = "core_accepted_burdened"
  }

  const qualifiers: PolicyQualifier[] = []
  if (profile.forwardBenefits.some((benefit) => benefit.liftStrength === "strong_lift") && profile.forwardBurdens.some((burden) => burden.liftStrength === "strong_lift")) {
    qualifiers.push("giustificabile_in_stato_di_necessita")
  }
  if (profile.forwardBurdens.length > 0) qualifiers.push("normativamente_burdened")
  if (profile.requiredConditions.length > 0 || hasRequiredMitigation(profile)) qualifiers.push("ammissibile_solo_se_condizionata")
  if (profile.coreCombined < 0.8) qualifiers.push("preferibile_ma_non_certo")
  if (profile.forwardBurdens.some((burden) => burden.epistemicState === "residual_live_risk")) qualifiers.push("operativamente_necessaria_con_residuo")
  if (profile.forwardBurdens.some((burden) => burden.mitigatedBy.some((m) => m.includes("override") || m.includes("necessity") || m.includes("stato_di_necessita")))) {
    qualifiers.push("giustificabile_in_stato_di_necessita")
  }
  if (profile.catastrophicGated) qualifiers.push("catastroficamente_bloccato")
  if (!feasible) qualifiers.push("non_selezionabile_infeasible")

  return {
    primaryDecision: decision,
    requiredConditions: profile.requiredConditions,
    requiredMitigations: profile.mitigations.filter((binding) => binding.required).map((binding) => binding.mitigation),
    profile: { ...profile, policyStatus, qualifiers: [...new Set(qualifiers)] },
    alternativesConsidered: slot ? slot.candidates.filter((candidate) => candidate !== decision).map((candidate) => ({ decision: candidate, reason: "alternative in decision slot" })) : [],
    residualRisks: profile.forwardBurdens.filter((burden) => burden.mitigationStatus !== "sufficiently_mitigated").map((burden) => burden.conclusion),
  }
}
