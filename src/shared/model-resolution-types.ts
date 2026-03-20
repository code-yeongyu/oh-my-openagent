import type { FallbackEntry } from "./model-requirements"

export type ModelResolutionRequest = {
  intent?: {
    uiSelectedModel?: string
    userModel?: string
    categoryDefaultModel?: string
  }
  constraints: {
    availableModels: Set<string>
  }
  policy?: {
    fallbackChain?: FallbackEntry[]
    systemDefaultModel?: string
  }
}

export type ModelResolutionProvenance =
  | "override"
  | "category-default"
  | "provider-fallback"
  | "system-default"

export type ModelResolutionResult = {
  model: string
  provenance: ModelResolutionProvenance
  variant?: string
  attempted?: string[]
  reason?: string
}
