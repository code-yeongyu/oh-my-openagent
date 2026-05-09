import type { FallbackEntry } from "./model-requirements"

export interface DelegatedModelConfig {
  providerID: string
  modelID: string
  variant?: string
  reasoningEffort?: string
  temperature?: number
  top_p?: number
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
}

/**
 * Sticky-model intent tag — kept SEPARATE from `DelegatedModelConfig` so the
 * model object preserves the exact provider/model/variant/tuning shape that
 * downstream consumers (and a large equality-checking test surface) rely on.
 *
 * "explicit" = the user explicitly named this model (CLI --model, /model,
 * agents.<name>.model override, per-member model in a TeamSpec). When the
 * runtime sees `modelIntent === "explicit"` on a task, the fallback retry
 * handler refuses to advance the chain — the task hard-errors instead,
 * preventing the silent DeepSeek -> Kimi swap that motivated this gate.
 *
 * "auto" = resolved by the system (category default, fallback chain,
 * system default). Chain advancement is permitted as before.
 *
 * Undefined is treated as "auto" for active sessions launched before this
 * field existed (backward compatibility).
 */
export type ModelIntent = "explicit" | "auto"

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
