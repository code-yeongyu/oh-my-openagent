import type { ComplexityLevel, CostTier, DelegationRecommendation, TaskAnalysis } from "./types"
import { CATEGORY_COST_MAP } from "./types"

export interface RouterOptions {
  teamModeEnabled: boolean
  domain?: string
}

const DOMAIN_CATEGORY_MAP: Record<string, string> = {
  "ui": "visual-engineering",
  "frontend": "visual-engineering",
  "styling": "visual-engineering",
  "design": "visual-engineering",
  "css": "visual-engineering",
  "writing": "writing",
  "doc": "writing",
  "readme": "writing",
  "algorithm": "ultrabrain",
  "logic": "ultrabrain",
  "architecture": "ultrabrain",
}

export function resolveCheapestCategory(
  level: ComplexityLevel,
  options?: RouterOptions,
): string {
  if (level === "trivial") return "quick"

  if (level === "standard") {
    const domain = options?.domain?.toLowerCase()
    if (domain && DOMAIN_CATEGORY_MAP[domain]) {
      return DOMAIN_CATEGORY_MAP[domain]
    }
    return "unspecified-low"
  }

  return "unspecified-high"
}

export function buildDelegationRecommendation(
  level: ComplexityLevel,
  options?: RouterOptions,
): DelegationRecommendation {
  const category = resolveCheapestCategory(level, options)
  const costInfo = CATEGORY_COST_MAP[category]
  const teamModeSuitable = options?.teamModeEnabled === true && level !== "complex"
  const costTier: CostTier = costInfo?.tier ?? "medium"

  let reasoning: string
  if (level === "trivial") {
    reasoning = `Trivial task → route to \`quick\` (cheapest, ${costTier} cost)`
  } else if (level === "standard") {
    const domainHint = options?.domain ? `domain:${options.domain}` : "no domain signal"
    reasoning = `Standard task (${domainHint}) → route to \`${category}\` (${costTier} cost)${
      teamModeSuitable ? ", suitable for team mode parallel execution" : ""
    }`
  } else {
    reasoning = `Complex task → route to \`${category}\` (${costTier} cost), requires deeper reasoning`
  }

  return {
    category,
    complexity: level,
    costTier,
    teamModeSuitable,
    reasoning,
  }
}

export function classifyAndRecommend(
  prompt: string,
  classifiedLevel: ComplexityLevel,
  options?: RouterOptions,
): TaskAnalysis {
  const recommendation = buildDelegationRecommendation(classifiedLevel, options)
  return {
    classification: { level: classifiedLevel, reason: recommendation.reasoning },
    recommendation,
  }
}

export function shouldUseTeamMode(
  taskAnalyses: TaskAnalysis[],
  teamModeEnabled: boolean,
): boolean {
  if (!teamModeEnabled) return false
  const independentTasks = taskAnalyses.filter((t) => t.recommendation.complexity !== "complex")
  return independentTasks.length >= 2
}
