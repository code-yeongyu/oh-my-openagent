import type { OmoaState } from "../state/omoa-state-schema"
import type { ModelRankingEntry } from "../state/omoa-rankings-schema"
import { isProviderEnabled } from "../state/state-manager"

export interface ResolveResult {
  primary: string | undefined
  fallback: string | undefined
  primaryReason: string
  fallbackReason: string
}

export function extractProvider(model: string): string {
  const idx = model.indexOf("/")
  return idx > 0 ? model.slice(0, idx) : model
}

function isModelAvailable(
  model: string,
  state: OmoaState,
): boolean {
  const provider = extractProvider(model)
  if (!isProviderEnabled(state, provider)) return false
  if (state.banned_models.includes(model)) return false
  if (state.deprecated_models.includes(model)) return false

  const providerState = state.providers[provider]
  if (providerState?.free_only && !model.endsWith("-free")) return false

  return true
}

function isFallbackCompatible(
  fallbackModel: string,
  primaryModel: string,
  state: OmoaState,
): boolean {
  const fbProvider = extractProvider(fallbackModel)
  const primaryProvider = extractProvider(primaryModel)

  if (fbProvider === primaryProvider) return false

  const providerState = state.providers[primaryProvider]
  if (providerState?.avoid_fallback_from?.includes(fbProvider)) return false

  return true
}

export function resolveBestModel(
  rankings: ModelRankingEntry[],
  state: OmoaState,
): ResolveResult {
  if (rankings.length === 0) {
    return { primary: undefined, fallback: undefined, primaryReason: "no rankings defined", fallbackReason: "no rankings" }
  }

  const available = rankings.filter((e) => isModelAvailable(e.model, state))

  if (available.length === 0) {
    const allDisabled = rankings.map((e) => `${e.model} (${isProviderEnabled(state, extractProvider(e.model)) ? "banned/deprecated" : "provider disabled"})`).join(", ")
    return { primary: undefined, fallback: undefined, primaryReason: `all rankings unavailable: ${allDisabled}`, fallbackReason: "no primary" }
  }

  const primary = available[0]
  const primaryRank = rankings.findIndex((e) => e.model === primary.model) + 1
  const primaryReason = `rank #${primaryRank}${isProviderEnabled(state, extractProvider(primary.model)) ? "" : " (provider disabled)"}`

  const fallback = available.find((e) => isFallbackCompatible(e.model, primary.model, state))

  let fallbackReason: string
  if (!fallback) {
    fallbackReason = "no compatible cross-provider fallback available"
  } else {
    const fbRank = rankings.findIndex((e) => e.model === fallback.model) + 1
    fallbackReason = `rank #${fbRank} (cross-provider)`
  }

  return {
    primary: primary.model,
    fallback: fallback?.model,
    primaryReason,
    fallbackReason,
  }
}
