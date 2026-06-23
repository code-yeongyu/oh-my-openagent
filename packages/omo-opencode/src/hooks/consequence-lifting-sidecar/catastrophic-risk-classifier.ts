import { TAG_RISK_CATASTROPHIC, type RiskThreshold } from "./tag-contract"

import type { CatastrophicClassification, CatastrophicLevel } from "./catastrophic-risk-types"

const CATASTROPHIC_TAGS = ["catastrophic:true", "irreversible:true", "extinction_risk:true"]
const ELEVATED_TAGS = ["safety:critical", "life_threatening:true", "fatality_risk:true"]
const CATASTROPHIC_TERMS = ["catastrophic", "crash", "fatal", "death", "irreversible"]
const UNKNOWN_CATASTROPHIC_TAG = /@risk:catastrophic:([^\s]+)/

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

function createClassification(
  conclusion: string,
  level: CatastrophicLevel,
  reasons: string[],
  threshold: RiskThreshold | null,
): CatastrophicClassification {
  return {
    conclusion,
    level,
    catastrophicGated: level === "catastrophic",
    threshold,
    reasons,
  }
}

function classifyLevel(conclusion: string, tags: string[]): {
  level: CatastrophicLevel
  reasons: string[]
  threshold: RiskThreshold | null
} {
  const thresholdMatch = conclusion.match(TAG_RISK_CATASTROPHIC)
  if (thresholdMatch) {
    const threshold = thresholdMatch[1] as RiskThreshold
    return { level: "catastrophic", reasons: [threshold], threshold }
  }

  const unknownThresholdMatch = conclusion.match(UNKNOWN_CATASTROPHIC_TAG)
  if (unknownThresholdMatch) {
    // Unknown threshold logged silently — does not gate
    return { level: "none", reasons: [], threshold: null }
  }

  const searchable = `${conclusion} ${tags.join(" ")}`.toLowerCase()
  const reasons: string[] = []

  if (hasAny(searchable, CATASTROPHIC_TAGS) || hasAny(searchable, CATASTROPHIC_TERMS)) {
    if (hasAny(searchable, CATASTROPHIC_TAGS)) reasons.push("catastrophic_tag")
    if (hasAny(searchable, CATASTROPHIC_TERMS)) reasons.push("catastrophic_term")
    return { level: "catastrophic", reasons, threshold: null }
  }

  if (hasAny(searchable, ELEVATED_TAGS)) {
    reasons.push("elevated_safety_tag")
    return { level: "elevated", reasons, threshold: null }
  }

  return { level: "none", reasons: [], threshold: null }
}

export function classifyCatastrophicRisk(conclusion: string, tags: string[]): CatastrophicClassification {
  const { level, reasons, threshold } = classifyLevel(conclusion, tags)
  return createClassification(conclusion, level, reasons, threshold)
}
