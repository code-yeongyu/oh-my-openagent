import type { SidecarOutput } from "../consequence-lifting-sidecar"

type SidecarSummaryInput = {
  optionMap: Map<string, string>
  selectedDecision: string
  sidecarResult: SidecarOutput | null
}

export function buildSelectedRationale(input: SidecarSummaryInput): string {
  const { optionMap, selectedDecision, sidecarResult } = input
  const selectedOption = optionMap.get(selectedDecision) ?? selectedDecision
  const humilitySummary = sidecarResult?.humility?.report.summary
  if (humilitySummary && humilitySummary !== "No unresolved structural gaps detected.") {
    return humilitySummary
  }
  const policy = sidecarResult?.policies.find(p => p.primaryDecision === selectedDecision)
  if (policy?.profile.forwardBurdens.length) {
    const burdenList = policy.profile.forwardBurdens.map(b => b.conclusion).join(", ")
    return `${selectedOption} selected. Forward burdens: ${burdenList}.`
  }
  return `${selectedOption} is the unique option surviving the applicable exclusion gates under preferred semantics.`
}

export function buildNoSelectableBundleRationale(sidecarResult: SidecarOutput | null): string {
  const humilitySummary = sidecarResult?.humility?.report.summary
  const escalationMessages = [...new Set((sidecarResult?.humility?.report.escalationReasons ?? []).map((reason) => reason.message).filter(Boolean))]

  if (escalationMessages.length > 0) {
    const joinedMessages = escalationMessages.join(" ")
    if (!humilitySummary || humilitySummary === joinedMessages || isGenericHumilitySummary(humilitySummary)) {
      return joinedMessages
    }
    if (humilitySummary.includes(joinedMessages)) {
      return humilitySummary
    }
    return `${joinedMessages} ${humilitySummary}`
  }

  if (humilitySummary) {
    return humilitySummary
  }

  return "No selectable bundle remains after applying exclusion gates and constraints."
}

export function buildFallbackBundleDetails(input: SidecarSummaryInput): {
  burdens: string[]
  mitigations: string[]
  guardrails: string[]
} {
  const { optionMap, selectedDecision, sidecarResult } = input
  const selectedOption = optionMap.get(selectedDecision) ?? selectedDecision
  if (!sidecarResult) {
    return {
      burdens: [`${selectedOption}: full downstream consequence characterization requires sidecar execution`],
      mitigations: [],
      guardrails: [`Verify sidecar analysis before acting on this selection`],
    }
  }
  const rejected = sidecarResult.policies
    .filter(p => p.primaryDecision !== selectedDecision)
    .map(p => optionMap.get(p.primaryDecision) ?? p.primaryDecision)
  return {
    burdens: rejected.length
      ? [`Options excluded: ${rejected.join("; ")}`]
      : [`No alternatives survived applicable exclusion gates`],
    mitigations: [],
    guardrails: [`Review sidecar contamination and catastrophic risk fields before acting`],
  }
}

function isGenericHumilitySummary(summary: string): boolean {
  return summary === "No unresolved structural gaps are currently blocking repairability, but multi-semantics comparison, confidence scores, and convergence status were not provided."
}
