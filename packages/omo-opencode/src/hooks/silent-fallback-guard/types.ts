export type FallbackRiskType =
  | "DEFAULT_VALUE"
  | "NULLISH_FALLBACK"
  | "ERROR_SWALLOW"
  | "CATCH_RETURN_DEFAULT"
  | "OPTIONAL_DEGRADATION"
  | "COMPAT_SHIM"
  | "ENV_FALLBACK"
  | "BEST_EFFORT"
  | "SILENT_RETRY_OR_IGNORE"

export type FallbackConfidence = "high" | "medium" | "low"

export interface FallbackCandidate {
  file: string
  line: number
  language: string
  riskType: FallbackRiskType
  confidence: FallbackConfidence
  raw: string
  normalized: string
  reason: string
  groupingKey: string
  commentContext?: string
}

export type FallbackDecision = "KEEP" | "REMOVE" | "USER_DECISION" | "SKIPPED_BUDGET"

export interface FallbackReviewRecord {
  candidate: FallbackCandidate
  decision: FallbackDecision
  justification: string
  contextSources: string[]
}

export type GuardFailOpenStatus = "DIFF_UNAVAILABLE" | "HOOK_ERROR" | "UNSUPPORTED_LANGUAGE" | "SATURATED"

export interface SilentFallbackGuardConfig {
  enabled: boolean
  mode: "report" | "pushback"
  maxReviewCandidates: number
  maxPerFile: number
  maxPerRiskType: number
  includeLowConfidence: boolean
  supportedLanguages: string[]
}
