import {
  areRuntimeFallbackModelsEquivalent,
  parseModelString,
  stringifyRuntimeFallbackModel,
  stringifyRuntimeFallbackModelWithVariant,
} from "@oh-my-opencode/model-core"
import type { FallbackState, FallbackResult } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import type { RuntimeFallbackConfig } from "../../config"

export const stringifyRuntimeModel = stringifyRuntimeFallbackModel
export const stringifyRuntimeModelWithVariant = stringifyRuntimeFallbackModelWithVariant

export function areRuntimeModelsEquivalent(candidate: string | undefined, current: string | undefined): boolean {
  return areRuntimeFallbackModelsEquivalent(candidate, current)
}

export function createFallbackState(originalModel: unknown): FallbackState {
  const model = stringifyRuntimeModel(originalModel) ?? String(originalModel)

  return {
    originalModel: model,
    currentModel: model,
    fallbackIndex: -1,
    failedModels: new Map<string, number>(),
    failedProviders: new Map<string, number>(),
    attemptCount: 0,
    pendingFallbackModel: undefined,
  }
}

export function isModelInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean {
  const failedAt = state.failedModels.get(model)
  if (failedAt === undefined) return false
  const cooldownMs = cooldownSeconds * 1000
  return Date.now() - failedAt < cooldownMs
}

/**
 * Extract provider ID from model string (e.g., "openai/gpt-4o" -> "openai")
 */
export function extractProviderFromModel(model: string): string | undefined {
  const parsed = parseModelString(model)
  return parsed?.providerID
}

/**
 * Check if a provider is in cooldown (all models from this provider should be skipped)
 */
export function isProviderInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean {
  const provider = extractProviderFromModel(model)
  if (!provider) return false
  const failedAt = state.failedProviders.get(provider)
  if (failedAt === undefined) return false
  const cooldownMs = cooldownSeconds * 1000
  return Date.now() - failedAt < cooldownMs
}

/**
 * Mark a provider as failed (for provider-wide quota exhaustion like 429)
 */
export function markProviderFailed(model: string, state: FallbackState): void {
  const provider = extractProviderFromModel(model)
  if (!provider) return
  state.failedProviders.set(provider, Date.now())
  log(`[${HOOK_NAME}] Provider marked as failed`, { provider })
}

export function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: string[],
  cooldownSeconds: number
): { model: string; index: number } | undefined {
  const len = fallbackModels.length
  // Search from current position forward, then wrap around to cover earlier entries.
  // This handles the case where the session's preferred model appears at a higher
  // index than the current fallback, so wrapping back to index 0 is necessary.
  for (let step = 1; step < len; step++) {
    const i = (state.fallbackIndex + step) % len
    const candidate = fallbackModels[i]
    if (areRuntimeFallbackModelsEquivalent(candidate, state.currentModel)) {
      log(`[${HOOK_NAME}] Skipping equivalent fallback model`, {
        model: candidate,
        currentModel: state.currentModel,
        index: i,
      })
      continue
    }

    // Check provider-level cooldown first (faster than model-level check)
    if (isProviderInCooldown(candidate, state, cooldownSeconds)) {
      log(`[${HOOK_NAME}] Skipping fallback model - provider in cooldown`, { 
        model: candidate, 
        provider: extractProviderFromModel(candidate),
        index: i 
      })
      continue
    }

    if (!isModelInCooldown(candidate, state, cooldownSeconds)) {
      return { model: candidate, index: i }
    }
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate, index: i })
  }
  return undefined
}

export function prepareFallback(
  sessionID: string,
  state: FallbackState,
  fallbackModels: string[],
  config: Required<RuntimeFallbackConfig>,
  options?: { isProviderFailure?: boolean }
): FallbackResult {
  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  const nextResult = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds)

  if (!nextResult) {
    log(`[${HOOK_NAME}] No available fallback models`, { sessionID })
    return { success: false, error: "No available fallback models (all in cooldown or exhausted)" }
  }

  log(`[${HOOK_NAME}] Preparing fallback`, {
    sessionID,
    from: state.currentModel,
    to: nextResult.model,
    attempt: state.attemptCount + 1,
    isProviderFailure: options?.isProviderFailure ?? false,
  })

  const failedModel = state.currentModel
  const now = Date.now()

  state.fallbackIndex = nextResult.index
  state.failedModels.set(failedModel, now)
  
  // Mark provider as failed for provider-wide errors (quota exhaustion, rate limits)
  if (options?.isProviderFailure) {
    markProviderFailed(failedModel, state)
  }
  
  state.attemptCount++
  state.currentModel = nextResult.model
  state.pendingFallbackModel = nextResult.model

  return { success: true, newModel: nextResult.model }
}
