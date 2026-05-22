import type { FallbackEntry } from "@oh-my-opencode/model-core"

/**
 * The state of a model fallback for a single session.
 * Tracks which model failed, the fallback chain, and progress through it.
 */
export type ModelFallbackState = {
  providerID: string
  modelID: string
  fallbackChain: FallbackEntry[]
  attemptCount: number
  pending: boolean
}

/**
 * The result of selecting the next fallback model.
 * Contains all parameters needed to switch the model.
 */
export type FallbackResult = {
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
 * A function that checks whether a fallback entry's providers are reachable.
 * Returns true if at least one provider in the entry is available.
 *
 * Harness adapters inject this to decouple from provider discovery:
 * - OpenCode: checks connected-providers-cache
 * - Claude Code: checks configured API keys
 * - Pi: checks extension registry
 */
export type ReachabilityChecker = (entry: FallbackEntry) => boolean

/**
 * Logger interface for fallback state transitions.
 * Defaults to no-op; harness adapters can inject a real logger.
 */
export type FallbackLogger = (message: string) => void
