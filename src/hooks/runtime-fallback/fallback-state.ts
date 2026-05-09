import type { FallbackState, FallbackResult } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import type { RuntimeFallbackConfig } from "../../config"
import { getModelFamily } from "../../agents/types"

export function createFallbackState(originalModel: string): FallbackState {
  return {
    originalModel,
    currentModel: originalModel,
    triedModels: new Set<string>(),
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

function isCandidateAvailable(
  candidate: string,
  state: FallbackState,
  cooldownSeconds: number,
): boolean {
  if (candidate === state.currentModel) return false
  if (state.triedModels.has(candidate)) return false
  if (isModelInCooldown(candidate, state, cooldownSeconds)) {
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate })
    return false
  }
  return true
}

/**
 * Two-pass family-aware fallback scan.
 *
 * Pass 1: only entries whose `getModelFamily(candidate)` matches the
 * `originalModel`'s family. Honors agent role intent — when a user pinned
 * `claude-sonnet-4.6` (Sisyphus's Claude family), Claude entries are tried
 * before drifting into Hephaestus's GPT territory, even when the user's
 * config interleaves them. See `src/hooks/no-sisyphus-gpt/hook.ts` for the
 * canonical Sisyphus → Claude/Kimi/GLM mapping that this preference mirrors.
 *
 * Pass 2: any remaining entry. Runs only after Pass 1 is exhausted (or
 * skipped when the original family is `"other"`, in which case there is no
 * meaningful preference to express).
 *
 * Both passes scan the WHOLE chain (not from a cursor), skipping models
 * already in `triedModels` or active cooldown. This avoids the prior
 * `fallbackIndex` bug where a high-index family-match permanently hid
 * lower-index non-family entries from later passes.
 */
export function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: string[],
  cooldownSeconds: number,
): string | undefined {
  const originalFamily = getModelFamily(state.originalModel)

  if (originalFamily !== "other") {
    for (const candidate of fallbackModels) {
      if (!isCandidateAvailable(candidate, state, cooldownSeconds)) continue
      if (getModelFamily(candidate) !== originalFamily) continue
      log(`[${HOOK_NAME}] Family-aware preference: selected same-family fallback`, {
        candidate,
        family: originalFamily,
        originalModel: state.originalModel,
      })
      return candidate
    }
  }

  for (const candidate of fallbackModels) {
    if (!isCandidateAvailable(candidate, state, cooldownSeconds)) continue
    if (originalFamily !== "other" && getModelFamily(candidate) !== originalFamily) {
      log(`[${HOOK_NAME}] Family-aware preference exhausted; selecting cross-family fallback`, {
        candidate,
        candidateFamily: getModelFamily(candidate),
        originalFamily,
        originalModel: state.originalModel,
      })
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

  state.failedModels.set(failedModel, now)
  state.triedModels.add(nextModel)
  state.attemptCount++
  state.currentModel = nextModel
  state.pendingFallbackModel = nextModel

  return { success: true, newModel: nextModel }
}
