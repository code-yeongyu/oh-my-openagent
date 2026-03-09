export type SanityLevel = "info" | "warn" | "error"

export type SanityIssueKind =
  | "model-not-in-cache"
  | "invalid-model-format"
  | "missing-fallback"
  | "unknown-category"
  | "fallback-not-in-cache"
  | "fallback-invalid-format"

export interface SanityIssue {
  path: string
  level: SanityLevel
  message: string
  kind: SanityIssueKind
}

export interface ConfiguredModelRef {
  path: string
  model: string
  type: "agent" | "category" | "fallback"
}

export interface SanityCheckResult {
  issues: SanityIssue[]
  checkedModels: ConfiguredModelRef[]
  hasErrors: boolean
  hasWarnings: boolean
}

export interface ModelCache {
  models: Set<string>
  providers: Set<string>
}

export type ProbeResult =
  | { ok: true; model: string }
  | { ok: false; model: string; error: string; shouldFallback: boolean }
