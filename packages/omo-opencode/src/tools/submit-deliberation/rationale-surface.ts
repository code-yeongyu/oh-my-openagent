import type { DeliberationResponse } from "../../agents/themis/types"
import type { AudienceAnalysis, ConvergenceStatus, SemanticsComparison } from "../../hooks/reasoning-core-policy-gate/extended-response-types"

type RationaleDetail = NonNullable<DeliberationResponse["rationale_detail"]>

export function buildRationaleSurface(input: {
  response: DeliberationResponse
  preferenceCycle: { detected: boolean; path: string[] }
  semanticsComparison: SemanticsComparison
  audienceAnalysis?: AudienceAnalysis
  convergence?: ConvergenceStatus
}): { rationale: string; rationale_detail?: RationaleDetail } {
  const { response } = input

  if (response.verdict === "selected") {
    return buildSelectedRationaleSurface(input)
  }

  if (response.verdict === "no_selectable_bundle") {
    return buildNoSelectableBundleRationaleSurface(input)
  }

  if (response.verdict === "defer_recommended") {
    return buildDeferRecommendedRationaleSurface(input)
  }

  return { rationale: response.rationale }
}

function buildSelectedRationaleSurface(input: {
  response: DeliberationResponse
  semanticsComparison: SemanticsComparison
  audienceAnalysis?: AudienceAnalysis
  convergence?: ConvergenceStatus
}): { rationale: string; rationale_detail: RationaleDetail } {
  const selectedOption = input.response.bundle?.selected_option ?? "Selected option"
  const excludedOptions = extractExcludedOptions(input.semanticsComparison.grounded_set, input.response.provenance.input_request.options)
  const selectedSummaryLabel = summarizeOptionLabel(selectedOption)
  const decisiveFactors = [
    ...excludedOptions.slice(0, 3).map((option) => `${option} excluded by stronger gates`),
    `${selectedOption} remains actionable after exclusions`,
  ]
  const audienceSignal = input.audienceAnalysis ? `audience consensus: ${input.audienceAnalysis.consensus}` : null
  const semanticsSignal = input.convergence ? `convergence: ${humanizeToken(input.convergence)}` : null
  const detail: RationaleDetail = {
    verdict_mode: "selected",
    verdict_basis: "One option remains actionable after stronger exclusions.",
    decisive_factors: decisiveFactors,
    audience_signal: audienceSignal,
    semantics_signal: semanticsSignal,
    risk_signal: null,
    actionability_signal: null,
  }

  return {
    rationale: [
      `${selectedSummaryLabel} selected because ${buildSelectedExclusionSummary(excludedOptions)}`,
      summarizeAudienceSignal(input.audienceAnalysis),
      summarizeConvergence(input.convergence),
    ].filter(Boolean).join("; ") + ".",
    rationale_detail: detail,
  }
}

function buildNoSelectableBundleRationaleSurface(input: {
  response: DeliberationResponse
  preferenceCycle: { detected: boolean; path: string[] }
  semanticsComparison: SemanticsComparison
  audienceAnalysis?: AudienceAnalysis
  convergence?: ConvergenceStatus
}): { rationale: string; rationale_detail: RationaleDetail } {
  const excludedOptions = extractExcludedOptions(input.semanticsComparison.grounded_set, input.response.provenance.input_request.options)
  const allOptionsExcluded = excludedOptions.length >= input.response.provenance.input_request.options.length
  const decisiveFactors = [
    allOptionsExcluded ? "All candidate options are currently excluded" : "No candidate option remained selectable",
    ...(input.preferenceCycle.detected ? ["Preference cycle detected in derived ordering"] : []),
  ]
  const audienceSignal = input.audienceAnalysis ? `audience consensus: ${input.audienceAnalysis.consensus}` : null
  const semanticsSignal = input.convergence ? `convergence: ${humanizeToken(input.convergence)}` : null
  const detail: RationaleDetail = {
    verdict_mode: "no_selectable_bundle",
    verdict_basis: "All candidate options are blocked by stronger gates or structural conflicts.",
    decisive_factors: decisiveFactors,
    audience_signal: audienceSignal,
    semantics_signal: semanticsSignal,
    risk_signal: null,
    actionability_signal: "actionability: irreparable",
  }

  return {
    rationale: [
      `No selectable bundle remains because ${allOptionsExcluded ? "all options are excluded" : "no option remains selectable"}`,
      ...(input.preferenceCycle.detected ? ["preference cycle detected"] : []),
      summarizeConvergence(input.convergence),
    ].filter(Boolean).join("; ") + ".",
    rationale_detail: detail,
  }
}

function buildDeferRecommendedRationaleSurface(input: {
  response: DeliberationResponse
  audienceAnalysis?: AudienceAnalysis
  convergence?: ConvergenceStatus
}): { rationale: string; rationale_detail: RationaleDetail } {
  const voi = getVoiResult(input.response.voi_analysis)
  const reason = voi?.reasons?.[0] ? humanizeToken(voi.reasons[0]) : "current ranking remains narrow"
  const detailReason = reason === "selection margin is narrow" ? "narrow" : reason
  const actionabilitySignal = voi?.recourseLevel ? `actionability: ${humanizeToken(voi.recourseLevel)}` : null
  const audienceSignal = input.audienceAnalysis ? `audience consensus: ${input.audienceAnalysis.consensus}` : null
  const semanticsSignal = input.convergence ? `convergence: ${humanizeToken(input.convergence)}` : null
  const detail: RationaleDetail = {
    verdict_mode: "defer_recommended",
    verdict_basis: "The current ranking is too unstable for immediate commitment.",
    decisive_factors: [
      "VOI indicates deferral is warranted",
      `Current ranking remains ${detailReason}`,
    ],
    audience_signal: audienceSignal,
    semantics_signal: semanticsSignal,
    risk_signal: null,
    actionability_signal: actionabilitySignal,
  }

  return {
    rationale: [
      `Defer recommended because ${reason}`,
      summarizeActionability(voi?.recourseLevel),
      summarizeConvergence(input.convergence),
    ].filter(Boolean).join("; ") + ".",
    rationale_detail: detail,
  }
}

function extractExcludedOptions(conclusions: string[], options: string[]): string[] {
  return conclusions.flatMap((conclusion) => {
    const option = mapOptionAtomToOption(conclusion, options)
    return option?.kind === "excluded" ? [option.label] : []
  })
}

function mapOptionAtomToOption(atom: string, options: string[]): { kind: "excluded" | "selected"; label: string } | null {
  const match = atom.match(/^(-)?select_option_([a-z])$/i)
  if (!match) return null
  const index = match[2].toUpperCase().charCodeAt(0) - 65
  const label = options[index]
  if (!label) return null
  return { kind: match[1] ? "excluded" : "selected", label }
}

function joinFactors(factors: string[]): string {
  if (factors.length === 0) return "no decisive factors were recorded"
  if (factors.length === 1) return factors[0]
  if (factors.length === 2) return `${factors[0]} and ${factors[1]}`
  return `${factors.slice(0, -1).join(", ")}, and ${factors.at(-1)}`
}

function humanizeToken(value: string): string {
  return value.replace(/_/g, " ")
}

function summarizeOptionLabel(value: string): string {
  const match = value.match(/^Option\s+[A-Z]/)
  return match?.[0] ?? value
}

function buildSelectedExclusionSummary(excludedOptions: string[]): string {
  const labels = excludedOptions.map(summarizeOptionLabel)
  if (labels.length === 0) {
    return "no stronger exclusion applies"
  }

  const formatted = formatOptionList(labels)
  return `${formatted} ${labels.length === 1 ? "is" : "are"} excluded`
}

function formatOptionList(labels: string[]): string {
  const optionCodes = labels
    .map((label) => label.match(/^Option\s+([A-Z])$/)?.[1] ?? null)
    .filter((code): code is string => code !== null)

  if (optionCodes.length === labels.length && optionCodes.length > 1) {
    if (optionCodes.length === 2) return `Options ${optionCodes[0]} and ${optionCodes[1]}`
    return `Options ${optionCodes.slice(0, -1).join(", ")}, and ${optionCodes.at(-1)}`
  }

  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`
}

function summarizeAudienceSignal(audienceAnalysis: AudienceAnalysis | undefined): string | null {
  if (!audienceAnalysis) return null
  return `${humanizeToken(audienceAnalysis.consensus)} audience`
}

function summarizeConvergence(convergence: ConvergenceStatus | undefined): string | null {
  return convergence ? humanizeToken(convergence) : null
}

function summarizeActionability(recourseLevel: string | undefined): string | null {
  return recourseLevel ? humanizeToken(recourseLevel) : null
}

function getVoiResult(value: DeliberationResponse["voi_analysis"]): { reasons?: string[]; recourseLevel?: string } | null {
  if (!isRecord(value) || !isRecord(value.result)) return null
  return {
    reasons: Array.isArray(value.result.reasons) ? value.result.reasons.filter((reason): reason is string => typeof reason === "string") : undefined,
    recourseLevel: typeof value.result.recourseLevel === "string" ? value.result.recourseLevel : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
