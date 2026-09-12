import type { FallbackModelObject } from "../config/schema/fallback-models"
import { normalizeFallbackModels } from "./model-resolver"

export interface ModelChainConfig {
  model?: string
  models?: (string | FallbackModelObject)[]
  fallback_models?: string | (string | FallbackModelObject)[]
}

export interface EffectiveModelChain {
  /** Every entry in precedence order: primary first, then fallbacks. */
  entries: (string | FallbackModelObject)[]
  primaryModel?: string
  fallbackEntries?: (string | FallbackModelObject)[]
}

export function modelChainEntryModel(entry: string | FallbackModelObject): string {
  return typeof entry === "string" ? entry : entry.model
}

function combineChain(config: ModelChainConfig): (string | FallbackModelObject)[] | undefined {
  const models = config.models
  if (!Array.isArray(models) || models.length === 0) return undefined

  const chain = [...models]
  const legacyFallbacks = normalizeFallbackModels(config.fallback_models)
  if (legacyFallbacks) chain.push(...legacyFallbacks)

  const headModel = config.model
  if (
    typeof headModel === "string" &&
    headModel.length > 0 &&
    modelChainEntryModel(chain[0]) !== headModel
  ) {
    // A legacy `model` written beside a canonical chain keeps its place as the
    // primary instead of being silently dropped, mirroring the agent-side
    // semantics of config-migration/reasoning-unification.
    chain.unshift(headModel)
  }
  return chain
}

/**
 * Resolve the effective ordered model chain from a user-authored agent or
 * category config. Only meaningful on raw user entries: merged or defaulted
 * records may carry a non-user `model` that must not be prepended to the
 * user's chain.
 */
export function resolveEffectiveModelChain(config: ModelChainConfig): EffectiveModelChain {
  const canonical = combineChain(config)
  if (canonical) {
    return {
      entries: canonical,
      primaryModel: modelChainEntryModel(canonical[0]),
      fallbackEntries: canonical.length > 1 ? canonical.slice(1) : undefined,
    }
  }

  const fallbackEntries = normalizeFallbackModels(config.fallback_models)
  return {
    entries: config.model === undefined ? [...(fallbackEntries ?? [])] : [config.model],
    primaryModel: config.model,
    fallbackEntries,
  }
}
