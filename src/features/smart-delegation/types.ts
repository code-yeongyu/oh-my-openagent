export const COMPLEXITY_LEVELS = ["trivial", "standard", "complex"] as const
export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number]

export const COST_TIERS = ["low", "medium", "high"] as const
export type CostTier = (typeof COST_TIERS)[number]

export interface ComplexityClassification {
  level: ComplexityLevel
  reason: string
}

export interface DelegationRecommendation {
  category: string
  complexity: ComplexityLevel
  costTier: CostTier
  teamModeSuitable: boolean
  reasoning: string
}

export interface TaskAnalysis {
  classification: ComplexityClassification
  recommendation: DelegationRecommendation
}

export const CATEGORY_COST_MAP: Record<string, { tier: CostTier; complexity: ComplexityLevel }> = {
  "quick": { tier: "low", complexity: "trivial" },
  "unspecified-low": { tier: "low", complexity: "standard" },
  "writing": { tier: "low", complexity: "standard" },
  "unspecified-high": { tier: "high", complexity: "complex" },
  "ultrabrain": { tier: "high", complexity: "complex" },
  "visual-engineering": { tier: "medium", complexity: "standard" },
  "deep": { tier: "medium", complexity: "complex" },
  "artistry": { tier: "medium", complexity: "standard" },
}
