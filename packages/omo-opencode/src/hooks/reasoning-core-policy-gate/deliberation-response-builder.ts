import type { DeliberationRequest, DeliberationResponse } from "../../agents/themis/types"
import type { SidecarOutput } from "../consequence-lifting-sidecar"
import { extractConfidenceFromSidecar } from "./confidence-scores"
import { extractUndercutRules, extractUnderminedPremises } from "./deliberation-response-attack-metadata"
import { buildNoSelectableBundleRationale, buildSelectedRationale } from "./deliberation-response-sidecar-summary"
import {
  buildMultipleExtensionsRationale,
  getSelectedDecision,
  getSolverSelectedDecision,
  hasMultiSelectInExtensions,
  hasNoSelectableBundle,
} from "./deliberation-response-selection"
import { getResultRecord, getSolverIterations, isRecord } from "./deliberation-response-shared"
import { TAG_OPTION, TAG_VALENCE_HARM } from "../consequence-lifting-sidecar/tag-contract"

export function buildDeliberationResponse(input: {
  request: DeliberationRequest
  theory: unknown
  argueResult: unknown
  optionMap: Map<string, string>
  sidecarResult: SidecarOutput | null
  sidecarError?: unknown
  solverIterations?: number
}): DeliberationResponse {
  const { request, theory, argueResult, optionMap, sidecarResult, sidecarError, solverIterations = 1 } = input
  const timestamp = new Date().toISOString()
  const resultRecord = getResultRecord(argueResult)
  const extensions = Array.isArray(resultRecord.extensions) ? resultRecord.extensions : []
  const proof_chain = flattenProofChain(resultRecord.conclusions)
  const underminedPremises = extractUnderminedPremises(resultRecord.conclusions)
  const undercutRules = extractUndercutRules(resultRecord.conclusions)
  const iterations = getSolverIterations(argueResult, solverIterations)
  const auditFields = buildAuditOverrides(sidecarResult, underminedPremises, undercutRules)

  if (extensions.length === 0) {
    return baseResponse(request, proof_chain, theory, argueResult, sidecarResult, timestamp, {
      verdict: "formalization_failed",
      rationale: "Formalization failed: reasoning-core returned no extensions.",
      bundle: null,
      error: null,
      iterations,
      ...auditFields,
    })
  }

  const sidecarHasDefiniteSelection = Object.values(sidecarResult?.bundle?.selection?.selectedBySlot ?? {}).flat().length === 1
  if (request.requested_semantics === "preferred" && (extensions.length > 1 || hasMultiSelectInExtensions(extensions)) && !sidecarHasDefiniteSelection) {
    return baseResponse(request, proof_chain, theory, argueResult, sidecarResult, timestamp, {
      verdict: "multiple_extensions",
      rationale: buildMultipleExtensionsRationale(extensions),
      bundle: null,
      extensions,
      error: null,
      iterations,
      ...auditFields,
    })
  }

  if (sidecarError) {
    const message = sidecarError instanceof Error ? sidecarError.message : String(sidecarError)
    return baseResponse(request, proof_chain, theory, argueResult, sidecarResult, timestamp, {
      verdict: "sidecar_internal_error",
      rationale: message,
      bundle: null,
      error: message,
      iterations,
      ...auditFields,
    })
  }

  const catastrophicBlocked = sidecarResult?.catastrophic?.blocked ?? []
  if (catastrophicBlocked.length > 0) {
    return baseResponse(request, proof_chain, theory, argueResult, sidecarResult, timestamp, {
      verdict: "catastrophic_blocked",
      rationale: `Catastrophic risk gate blocked the following decisions: ${catastrophicBlocked.join(", ")}.`,
      bundle: null,
      error: null,
      iterations,
      ...auditFields,
    })
  }

  const sidecarHasNoCandidates = !sidecarResult?.bundle?.selection?.selectedBySlot ||
    Object.values(sidecarResult.bundle.selection.selectedBySlot).flat().length === 0
  const selectedDecision = getSelectedDecision(sidecarResult) ??
    (sidecarHasNoCandidates ? getSolverSelectedDecision(extensions, optionMap) : null)
  const rationale = selectedDecision
    ? buildSelectedRationale({ optionMap, selectedDecision, sidecarResult })
    : buildNoSelectableBundleRationale(sidecarResult)
  if (!selectedDecision || hasNoSelectableBundle(sidecarResult)) {
    return baseResponse(request, proof_chain, theory, argueResult, sidecarResult, timestamp, {
      verdict: "no_selectable_bundle",
      rationale,
      bundle: null,
      error: null,
      iterations,
      ...auditFields,
    })
  }

  const voiDeferRecommended = sidecarResult?.voi?.result.deferRecommended === true
  return baseResponse(request, proof_chain, theory, argueResult, sidecarResult, timestamp, {
    verdict: voiDeferRecommended ? "defer_recommended" : "selected",
    rationale,
    bundle: buildBundle(selectedDecision, sidecarResult, optionMap, theory),
    error: null,
    iterations,
    ...auditFields,
  })
}

function buildAuditOverrides(
  sidecarResult: SidecarOutput | null,
  underminedPremises: string[],
  undercutRules: string[],
): Pick<DeliberationResponse, "catastrophic_risks" | "undermined_premises" | "undercut_rules" | "voi_analysis" | "repair_humility"> {
  return {
    catastrophic_risks: sidecarResult?.catastrophic?.classifications
      .filter((classification) => classification.level !== "none")
      .map((classification) => classification.conclusion),
    undermined_premises: underminedPremises,
    undercut_rules: undercutRules,
    voi_analysis: sidecarResult?.voi ?? null,
    repair_humility: sidecarResult?.humility?.report.summary,
  }
}

function baseResponse(
  request: DeliberationRequest,
  proof_chain: Array<{ conclusion: string; from: string[]; rule_id: string | null; rule_kind: string }>,
  theory: unknown,
  argueResult: unknown,
  sidecarResult: SidecarOutput | null,
  timestamp: string,
  overrides: Partial<DeliberationResponse> & Pick<DeliberationResponse, "verdict" | "rationale" | "bundle"> & { iterations: number },
): DeliberationResponse {
  return {
    verdict: overrides.verdict,
    rationale: overrides.rationale,
    proof_chain,
    sidecar_trace: { theory, extensions: getResultRecord(argueResult).extensions ?? [], argue_result: argueResult, sidecar: sidecarResult },
    provenance: { semantics: request.requested_semantics, iterations: overrides.iterations, timestamp, input_request: request },
    bundle: overrides.bundle,
    extensions: overrides.extensions,
    catastrophic_risks: overrides.catastrophic_risks,
    undermined_premises: overrides.undermined_premises,
    undercut_rules: overrides.undercut_rules,
    voi_analysis: overrides.voi_analysis,
    repair_humility: overrides.repair_humility,
    confidence: extractConfidenceFromSidecar(sidecarResult) ?? undefined,
    error: overrides.error,
  }
}

function buildBundle(selectedDecision: string, sidecarResult: SidecarOutput | null, optionMap: Map<string, string>, theory: unknown) {
  const selectedPolicy = sidecarResult?.policies.find((policy) => policy.primaryDecision === selectedDecision)
  const sidecarBurdens = selectedPolicy?.profile.forwardBurdens.map((burden) => burden.conclusion) ?? []
  const fallbackBurdens = sidecarBurdens.length > 0 ? sidecarBurdens : extractTheoryTaggedHarmsForSelectedOption(selectedDecision, theory)
  const actionGuidance = deriveActionGuidance(selectedDecision, selectedPolicy, sidecarResult)
  return {
    selected_option: optionMap.get(selectedDecision) ?? selectedDecision,
    burdens: fallbackBurdens,
    mitigations: actionGuidance.mitigations,
    guardrails: actionGuidance.guardrails,
  }
}

function deriveActionGuidance(
  selectedDecision: string,
  selectedPolicy: SidecarOutput["policies"][number] | undefined,
  sidecarResult: SidecarOutput | null,
): { mitigations: string[]; guardrails: string[] } {
  const mitigations = dedupeMessages([
    ...(selectedPolicy?.requiredMitigations ?? []),
    ...(sidecarResult?.voi?.result.recourseLevel === "partially_reversible"
      ? ["Prefer a reversible implementation path where available."]
      : []),
  ])

  const guardrails = dedupeMessages([
    ...(selectedPolicy?.completeness?.gaps.map((gap) => gap.message) ?? []),
    ...(selectedPolicy?.implementationSafety?.violations.map((violation) => violation.message) ?? []),
    ...(hasHighContamination(selectedDecision, sidecarResult)
      ? ["Do not rely on contaminated or severed evidence as the sole basis for execution."]
      : []),
    ...(hasCatastrophicSignal(sidecarResult)
      ? ["Require explicit human sign-off before any irreversible action."]
      : []),
    ...(selectedPolicy?.residualRisks ?? []),
  ])

  return {
    mitigations: mitigations.slice(0, 3),
    guardrails: guardrails.slice(0, 3),
  }
}

function hasHighContamination(selectedDecision: string, sidecarResult: SidecarOutput | null): boolean {
  return sidecarResult?.contamination?.results.some((result) => result.conclusion === selectedDecision && result.level === "high") ?? false
}

function hasCatastrophicSignal(sidecarResult: SidecarOutput | null): boolean {
  return sidecarResult?.catastrophic?.classifications.some((classification) => classification.level !== "none") ?? false
}

function dedupeMessages(messages: string[]): string[] {
  return [...new Set(messages.filter((message) => message.trim().length > 0))]
}

function extractTheoryTaggedHarmsForSelectedOption(selectedDecision: string, theory: unknown): string[] {
  if (!isRecord(theory)) return []
  const theoryObject = isRecord(theory.theory) ? theory.theory : theory
  const premises = Array.isArray(theoryObject.premises) ? theoryObject.premises : []
  const suffix = selectedDecision.replace(/^.*select[_(]?option[_:]?/i, '').replace(/[)\s].*$/, '')
  const lowerSuffix = suffix.toLowerCase()
  const optionNeedles = new Set<string>([
    `@option:option_${lowerSuffix}`,
    `@option:${lowerSuffix}`,
    `@option:${suffix}`,
  ])
  const harms: string[] = []
  for (const premise of premises) {
    if (!isRecord(premise) || typeof premise.formula !== 'string') continue
    const formula = premise.formula
    if (!TAG_VALENCE_HARM.test(formula)) continue
    const optionMatch = formula.match(TAG_OPTION)
    if (!optionMatch) continue
    const taggedOption = `@option:${optionMatch[1]}`
    if (optionNeedles.has(taggedOption.toLowerCase()) || optionNeedles.has(taggedOption)) {
      harms.push(formula)
    }
  }
  return harms
}

function flattenProofChain(conclusions: unknown): Array<{ conclusion: string; from: string[]; rule_id: string | null; rule_kind: string }> {
  if (!isRecord(conclusions)) return []
  return Object.values(conclusions).flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.proof_chain)) return []
    return entry.proof_chain.flatMap((step) => {
      if (!isRecord(step) || typeof step.conclusion !== "string" || !Array.isArray(step.from) || typeof step.rule_kind !== "string") {
        return []
      }
      return [{ conclusion: step.conclusion, from: step.from.filter((item): item is string => typeof item === "string"), rule_id: typeof step.rule_id === "string" ? step.rule_id : null, rule_kind: step.rule_kind }]
    })
  })
}
