import type { AudienceAnalysis, AudienceResult } from "../extended-response-types"
import type { ReasonArgueRequest, ReasoningCoreClient } from "../reasoning-core-client"
import type { AudienceDefinition } from "./audience-categories"
import { analyzeAudienceConsensus } from "./consensus-analyzer"
import { extractValueDimensions, type VafTheory, type ValueDimension } from "./values-schema"

interface SolveValueBasedArgumentationInput {
  client: Pick<ReasoningCoreClient, "argue">
  theory: VafTheory
  requestedSemantics: NonNullable<ReasonArgueRequest["semantics"]>
  audiences: AudienceDefinition[]
}

interface AudienceComputation extends AudienceResult {
  extension_signature: string
}

export async function solveValueBasedArgumentation(
  input: SolveValueBasedArgumentationInput
): Promise<AudienceAnalysis> {
  const settled = await Promise.allSettled(input.audiences.map(async (audience) => {
    return await solveForAudience(input.client, input.theory, input.requestedSemantics, audience)
  }))

  const audienceResults = settled.map((result, index) => {
    const audience = input.audiences[index]
    if (result.status === "fulfilled") {
      return result.value
    }

    return createFailedAudienceResult(audience)
  })

  const successful = audienceResults.filter((result) => result.verdict !== "analysis_failed")
  const audiences = audienceResults.map(stripExtensionSignature)

  return {
    audiences,
    consensus: analyzeAudienceConsensus(successful),
    per_audience: Object.fromEntries(audiences.map((result) => [result.audience_id, result])),
  }
}

async function solveForAudience(
  client: Pick<ReasoningCoreClient, "argue">,
  theory: VafTheory,
  semantics: NonNullable<ReasonArgueRequest["semantics"]>,
  audience: AudienceDefinition
): Promise<AudienceComputation> {
  const overriddenTheory = {
    ...theory,
    preferences: overridePreferences(theory, audience.value_ordering),
  }
  const argueResult = await client.argue?.({ theory: overriddenTheory, semantics })
  const conclusions = getAcceptedConclusions(argueResult)
  const selectedOption = pickSelectedOption(conclusions)

  return {
    audience_id: audience.id,
    audience_label: audience.label,
    value_ordering: audience.value_ordering.map((value) => `@value:${value}`),
    selected_option: selectedOption,
    verdict: selectedOption ? "selected" : "no_selection",
    extension_signature: conclusions.join("|") || "<empty>",
  }
}

function overridePreferences(theory: VafTheory, ordering: ValueDimension[]): Array<{ superior: string; inferior: string }> {
  const derived = deriveValuePreferences(theory, ordering)
  if (derived.length === 0) {
    return theory.preferences ?? []
  }

  const taggedRuleIDs = new Set(derived.flatMap((preference) => [preference.superior, preference.inferior]))
  const basePreferences = (theory.preferences ?? []).filter((preference) => {
    return !taggedRuleIDs.has(preference.superior) || !taggedRuleIDs.has(preference.inferior)
  })

  return [...derived, ...basePreferences]
}

function deriveValuePreferences(theory: VafTheory, ordering: ValueDimension[]): Array<{ superior: string; inferior: string }> {
  const rankedRules = (theory.defeasible_rules ?? []).map((rule) => ({ id: rule.id, rank: getAudienceRank(rule, ordering) }))
    .filter((rule): rule is { id: string; rank: number } => rule.rank !== null)

  const preferences: Array<{ superior: string; inferior: string }> = []
  for (const left of rankedRules) {
    for (const right of rankedRules) {
      if (left.id === right.id || left.rank === right.rank) continue
      if (left.rank < right.rank) {
        preferences.push({ superior: left.id, inferior: right.id })
      }
    }
  }

  return dedupePreferences(preferences)
}

function getAudienceRank(
  rule: { id: string; antecedents: string[]; consequent: string },
  ordering: ValueDimension[]
): number | null {
  const source = [rule.id, rule.consequent, ...rule.antecedents].join(" ")
  const values = extractValueDimensions(source)
  const ranks = values.map((value) => ordering.indexOf(value)).filter((rank) => rank >= 0)
  if (ranks.length === 0) return null
  return Math.min(...ranks)
}

function getAcceptedConclusions(argueResult: unknown): string[] {
  const resultRecord = isRecord(argueResult) && isRecord(argueResult.result) ? argueResult.result : argueResult
  if (!isRecord(resultRecord)) return []
  const extensions = Array.isArray(resultRecord.extensions) ? resultRecord.extensions : []
  const firstExtension = extensions[0]
  if (!isRecord(firstExtension) || !Array.isArray(firstExtension.accepted_conclusions)) return []

  return firstExtension.accepted_conclusions.filter((conclusion): conclusion is string => {
    return typeof conclusion === "string" && !conclusion.startsWith("@") && !conclusion.startsWith("-")
  }).sort()
}

function pickSelectedOption(conclusions: string[]): string | undefined {
  return conclusions.find((conclusion) => {
    return conclusion.startsWith("select(") || conclusion.startsWith("select_") || conclusion.includes("selected")
  })
}

function dedupePreferences(
  preferences: Array<{ superior: string; inferior: string }>
): Array<{ superior: string; inferior: string }> {
  const seen = new Set<string>()
  return preferences.filter((preference) => {
    const key = `${preference.superior}>${preference.inferior}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function createFailedAudienceResult(audience: AudienceDefinition): AudienceComputation {
  return {
    audience_id: audience.id,
    audience_label: audience.label,
    value_ordering: audience.value_ordering.map((value) => `@value:${value}`),
    verdict: "analysis_failed",
    extension_signature: "<failed>",
  }
}

function stripExtensionSignature(result: AudienceComputation): AudienceResult {
  return {
    audience_id: result.audience_id,
    audience_label: result.audience_label,
    value_ordering: result.value_ordering,
    selected_option: result.selected_option,
    verdict: result.verdict,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
