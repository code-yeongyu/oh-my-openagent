import type { FallbackState, FallbackResult } from "./types"
import { HOOK_NAME, isProviderBlacklisted } from "./constants"
import { log } from "../../shared/logger"
import type { RuntimeFallbackConfig } from "../../config"

function extractProviderFromModel(model: string): string | undefined {
  const parts = model.split("/")
  return parts.length > 0 ? parts[0] : undefined
}

export function createFallbackState(originalModel: string): FallbackState {
  return {
    originalModel,
    currentModel: originalModel,
    fallbackIndex: -1,
    failedModels: new Map<string, number>(),
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

export function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: string[],
  cooldownSeconds: number
): string | undefined {
  for (let i = state.fallbackIndex + 1; i < fallbackModels.length; i++) {
    const candidate = fallbackModels[i]
    
    // Check session-level cooldown
    if (isModelInCooldown(candidate, state, cooldownSeconds)) {
      log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate, index: i })
      continue
    }
    
    // Check global provider blacklist
    const providerID = extractProviderFromModel(candidate)
    if (providerID && isProviderBlacklisted(providerID, cooldownSeconds)) {
      log(`[${HOOK_NAME}] Skipping fallback model - provider globally blacklisted`, { 
        model: candidate, 
        provider: providerID,
        index: i 
      })
      continue
    }
    
    return candidate
  }
  return undefined
}

export function prepareFallback(
  sessionID: string,
  state: FallbackState,
  fallbackModels: string[],
  config: Required<RuntimeFallbackConfig>
): FallbackResult {
  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  const nextModel = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds)

  if (!nextModel) {
    log(`[${HOOK_NAME}] No available fallback models`, { sessionID })
    return { success: false, error: "No available fallback models (all in cooldown or exhausted)" }
  }

  log(`[${HOOK_NAME}] Preparing fallback`, {
    sessionID,
    from: state.currentModel,
    to: nextModel,
    attempt: state.attemptCount + 1,
  })

  const failedModel = state.currentModel
  const now = Date.now()

  state.fallbackIndex = fallbackModels.indexOf(nextModel)
  state.failedModels.set(failedModel, now)
  state.attemptCount++
  state.currentModel = nextModel
  state.pendingFallbackModel = nextModel

  return { success: true, newModel: nextModel }
}

/**
 * Blacklist the original model's provider when rate limited
 * This prevents new sessions/subagents from using the same provider
 */
export function blacklistFailedProvider(model: string, cooldownSeconds: number): void {
  const providerID = extractProviderFromModel(model)
  if (providerID) {
    const { blacklistProvider, isProviderBlacklisted } = require("./constants")
    if (!isProviderBlacklisted(providerID, cooldownSeconds)) {
      blacklistProvider(providerID)
      log(`[${HOOK_NAME}] Globally blacklisted provider due to rate limit`, { 
        provider: providerID,
        cooldownSeconds 
      })
    }
  }
}
