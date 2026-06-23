import type { PromotionCandidate } from "../memory-core/types"

export interface PromotionRule {
  name: string
  description: string
  evaluate(candidate: PromotionCandidate): { passes: boolean; reason: string }
}

export const typeAllowlistRule: PromotionRule = {
  name: "type_allowlist",
  description:
    "Only promotable observation types are allowed: decision, discovery, benchmark, rule, convention",
  evaluate: (candidate) => {
    const allowed = ["decision", "discovery", "benchmark", "rule", "convention"]
    const passes = allowed.includes(candidate.proposed_type)

    return {
      passes,
      reason: passes
        ? `Type '${candidate.proposed_type}' is in the allowlist`
        : `Type '${candidate.proposed_type}' is not in the allowlist [${allowed.join(",")}] (MNH-11)`,
    }
  },
}

export const contentQualityRule: PromotionRule = {
  name: "content_quality",
  description: "Raw content must have minimum length to be useful",
  evaluate: (candidate) => {
    const minLength = 20
    const passes = candidate.raw_content.length >= minLength

    return {
      passes,
      reason: passes
        ? `Content length ${candidate.raw_content.length} meets minimum ${minLength}`
        : `Content too short: ${candidate.raw_content.length} chars < ${minLength} minimum`,
    }
  },
}

export const confidenceRule: PromotionRule = {
  name: "confidence_threshold",
  description: "Classifier score must be above minimum threshold",
  evaluate: (candidate) => {
    const minScore = 0.05
    const passes = candidate.classifier_score >= minScore

    return {
      passes,
      reason: passes
        ? `Score ${candidate.classifier_score.toFixed(2)} >= minimum ${minScore}`
        : `Score ${candidate.classifier_score.toFixed(2)} < minimum ${minScore}`,
    }
  },
}

export const DEFAULT_RULES: PromotionRule[] = [
  typeAllowlistRule,
  contentQualityRule,
  confidenceRule,
]

export interface RulesEvaluationResult {
  candidate_id: string
  rules_passed: string[]
  rules_failed: string[]
  overall_pass: boolean
  trace: Array<{ rule: string; passes: boolean; reason: string }>
}

export function evaluateRules(
  candidate: PromotionCandidate,
  rules: PromotionRule[] = DEFAULT_RULES,
): RulesEvaluationResult {
  const trace = rules.map((rule) => {
    const result = rule.evaluate(candidate)
    return { rule: rule.name, passes: result.passes, reason: result.reason }
  })

  const rules_passed = trace.filter((entry) => entry.passes).map((entry) => entry.rule)
  const rules_failed = trace.filter((entry) => !entry.passes).map((entry) => entry.rule)

  return {
    candidate_id: candidate.source_memory_id,
    rules_passed,
    rules_failed,
    overall_pass: rules_failed.length === 0,
    trace,
  }
}
