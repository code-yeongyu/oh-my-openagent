export type SanityLevel = "info" | "warn" | "error"

export interface SanityIssue {
  path: string
  level: SanityLevel
  message: string
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
