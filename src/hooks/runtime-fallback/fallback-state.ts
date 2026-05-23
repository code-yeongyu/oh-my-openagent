import type { FallbackState, FallbackResult } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import type { RuntimeFallbackConfig } from "../../config"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"

export function stringifyRuntimeModel(model: unknown): string | undefined {
  if (typeof model === "string") return model

  if (typeof model === "object" && model !== null) {
    const candidate = model as { providerID?: unknown; modelID?: unknown; variant?: unknown }
    if (typeof candidate.providerID === "string" && typeof candidate.modelID === "string") {
      const providerID = candidate.providerID.trim()
      const modelID = candidate.modelID.trim()
      const variant = typeof candidate.variant === "string" ? candidate.variant.trim() : undefined

      if (!providerID || !modelID) return undefined

      const baseModel = `${providerID}/${modelID}`
      return variant
        ? `${baseModel}(${variant})`
        : baseModel
    }
  }

  return undefined
}

export function stringifyRuntimeModelWithVariant(model: unknown, variant: unknown): string | undefined {
  const baseModel = stringifyRuntimeModel(model)
  const fallbackVariant = typeof variant === "string" ? variant.trim() : undefined
  if (!baseModel || !fallbackVariant) return baseModel

  const parsed = parseModelString(baseModel)
  if (!parsed?.providerID || !parsed.modelID || parsed.variant) return baseModel

  return `${parsed.providerID}/${parsed.modelID}(${fallbackVariant})`
}

function canonicalizeModelID(modelID: string): string {
  const loweredModelID = modelID.toLowerCase()
  const dottedModelID = loweredModelID.replace(/\./g, "-")

  if (
    dottedModelID.startsWith("claude-opus-") ||
    dottedModelID.startsWith("claude-sonnet-") ||
    dottedModelID.startsWith("claude-haiku-")
  ) {
    return dottedModelID
      .replace(/-thinking$/i, "")
      .replace(/-max$/i, "")
      .replace(/-high$/i, "")
  }

  return dottedModelID
}

function canonicalizeProviderFamily(providerID: string, modelID: string): string {
  const canonicalModelID = canonicalizeModelID(modelID)

  if (
    canonicalModelID.startsWith("claude-opus-") ||
    canonicalModelID.startsWith("claude-sonnet-") ||
    canonicalModelID.startsWith("claude-haiku-")
  ) {
    return "anthropic-compatible-claude"
  }

  return providerID.toLowerCase()
}

function parseCanonicalModel(model: string): { providerID: string; modelID: string } | undefined {
  const parsed = parseModelString(model)
  if (!parsed?.providerID || !parsed.modelID) return undefined

  const canonicalModelID = canonicalizeModelID(parsed.modelID)
  const variant = parsed.variant?.toLowerCase()

  return {
    providerID: canonicalizeProviderFamily(parsed.providerID, parsed.modelID),
    modelID: variant ? `${canonicalModelID}::${variant}` : canonicalModelID,
  }
}

function isEquivalentModel(candidate: string, current: string): boolean {
  const parsedCandidate = parseCanonicalModel(candidate)
  const parsedCurrent = parseCanonicalModel(current)

  if (!parsedCandidate || !parsedCurrent) {
    return candidate.toLowerCase() === current.toLowerCase()
  }

  return (
    parsedCandidate.providerID === parsedCurrent.providerID &&
    parsedCandidate.modelID === parsedCurrent.modelID
  )
}

export function areRuntimeModelsEquivalent(candidate: string | undefined, current: string | undefined): boolean {
  if (!candidate || !current) return false
  return isEquivalentModel(candidate, current)
}

export function createFallbackState(originalModel: unknown): FallbackState {
  const model = stringifyRuntimeModel(originalModel) ?? String(originalModel)

  return {
    originalModel: model,
    currentModel: model,
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
    if (isEquivalentModel(candidate, state.currentModel)) {
      log(`[${HOOK_NAME}] Skipping equivalent fallback model`, {
        model: candidate,
        currentModel: state.currentModel,
        index: i,
      })
      continue
    }

    if (!isModelInCooldown(candidate, state, cooldownSeconds)) {
      return candidate
    }
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate, index: i })
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
