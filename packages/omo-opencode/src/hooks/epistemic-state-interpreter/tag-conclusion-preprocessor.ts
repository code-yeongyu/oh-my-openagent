import {
  TAG_CONTAM_COI,
  TAG_CONTAM_SEVERANCE,
  TAG_OPTION,
  TAG_RISK_CATASTROPHIC,
  TAG_VALENCE_BENEFIT,
  TAG_VALENCE_HARM,
  TAG_VALUE,
} from "../consequence-lifting-sidecar/tag-contract"

export interface TagEnrichment {
  premiseTags: string[]
  optionId: string | null
  riskLevel: string | null
  contamAxis: string | null
  valencePolarity: "harm" | "benefit" | null
  valenceSeverity: string | null
  valueDimension: string | null
}

export function extractTagsFromConclusion(conclusion: string): TagEnrichment {
  const premiseTags: string[] = []
  let optionId: string | null = null
  let riskLevel: string | null = null
  let contamAxis: string | null = null
  let valencePolarity: "harm" | "benefit" | null = null
  let valenceSeverity: string | null = null
  let valueDimension: string | null = null

  const riskMatch = conclusion.match(TAG_RISK_CATASTROPHIC)
  if (riskMatch) {
    riskLevel = riskMatch[1]
    premiseTags.push(`risk:${riskLevel}`)
  }

  const coiMatch = conclusion.match(TAG_CONTAM_COI)
  if (coiMatch) {
    contamAxis = `coi:${coiMatch[1]}`
    premiseTags.push(`contamination:${coiMatch[1]}`)
  }

  const severanceMatch = conclusion.match(TAG_CONTAM_SEVERANCE)
  if (severanceMatch) {
    contamAxis = contamAxis ?? `severance:${severanceMatch[1]}`
    premiseTags.push(`severance:${severanceMatch[1]}`)
  }

  const harmMatch = conclusion.match(TAG_VALENCE_HARM)
  if (harmMatch) {
    valencePolarity = "harm"
    valenceSeverity = harmMatch[1]
    premiseTags.push(`harm:${harmMatch[1]}`)
  }

  const benefitMatch = conclusion.match(TAG_VALENCE_BENEFIT)
  if (benefitMatch) {
    valencePolarity = "benefit"
    valenceSeverity = benefitMatch[1]
    premiseTags.push(`benefit:${benefitMatch[1]}`)
  }

  const optionMatch = conclusion.match(TAG_OPTION)
  if (optionMatch) {
    optionId = optionMatch[1]
    premiseTags.push(`option:${optionMatch[1]}`)
  }

  const valueMatch = conclusion.match(TAG_VALUE)
  if (valueMatch) {
    valueDimension = valueMatch[1]
    premiseTags.push(`value:${valueMatch[1]}`)
  }

  return {
    premiseTags,
    optionId,
    riskLevel,
    contamAxis,
    valencePolarity,
    valenceSeverity,
    valueDimension,
  }
}

export function enrichParsedConclusionWithTags(
  conclusion: string,
  existingTags: string[],
): string[] {
  const extracted = extractTagsFromConclusion(conclusion)
  const merged = new Set([...existingTags, ...extracted.premiseTags])
  return Array.from(merged)
}
