import type { OhMyOpenCodeConfig } from "../config"
import type { FallbackModelObject } from "../config/schema/fallback-models"
import type { FallbackEntry } from "./model-requirements"
import { addConfigLoadError } from "./config-errors"
import { log } from "./logger"
import { normalizeFallbackModels } from "./model-resolver"

const HOOK_NAME = "disabled-providers"

export function getModelProvider(model: string): string | undefined {
  const slash = model.indexOf("/")
  if (slash <= 0) return undefined
  const provider = model.slice(0, slash).trim()
  return provider || undefined
}

export function isProviderDisabled(
  model: string | undefined,
  disabled: readonly string[],
): boolean {
  if (!model || disabled.length === 0) return false
  const provider = getModelProvider(model)
  if (provider === undefined) return false
  const providerLower = provider.toLowerCase()
  return disabled.some((entry) => entry.trim().toLowerCase() === providerLower)
}

export function isProviderNameDisabled(
  providerID: string | undefined,
  disabled: readonly string[] | undefined,
): boolean {
  if (!providerID || !disabled || disabled.length === 0) return false

  const provider = providerID.trim().toLowerCase()
  if (!provider) return false

  return disabled.some((entry) => entry.trim().toLowerCase() === provider)
}

export function filterDisabledProvidersFromFallbackChain(
  fallbackChain: readonly FallbackEntry[] | undefined,
  disabled: readonly string[] | undefined,
): FallbackEntry[] | undefined {
  if (!fallbackChain) return undefined
  if (!disabled || disabled.length === 0) return [...fallbackChain]

  const filteredChain = fallbackChain
    .map((entry) => ({
      ...entry,
      providers: entry.providers.filter((provider) => !isProviderNameDisabled(provider, disabled)),
    }))
    .filter((entry) => entry.providers.length > 0)

  return filteredChain.length > 0 ? filteredChain : undefined
}

export function filterDisabledProviderModels<T extends string | FallbackModelObject>(
  models: readonly T[],
  disabled: readonly string[],
): T[] {
  if (disabled.length === 0) return [...models]
  return models.filter((entry) => {
    const model = typeof entry === "string" ? entry : entry.model
    return !isProviderDisabled(model, disabled)
  })
}

type ModelHolder = {
  model?: string | unknown
  fallback_models?: string | (string | FallbackModelObject)[]
}

function findFirstAllowedReplacement(
  chain: (string | FallbackModelObject)[] | undefined,
  disabled: readonly string[],
): string | undefined {
  if (!chain) return undefined
  for (const entry of chain) {
    const model = typeof entry === "string" ? entry : entry.model
    if (!isProviderDisabled(model, disabled)) return model
  }
  return undefined
}

function applyToHolder(label: string, holder: ModelHolder, disabled: readonly string[]): void {
  const normalizedChain = normalizeFallbackModels(holder.fallback_models)
  if (normalizedChain) {
    const filteredChain = filterDisabledProviderModels(normalizedChain, disabled)
    if (filteredChain.length !== normalizedChain.length) {
      log(`[${HOOK_NAME}] Filtered disabled-provider entries from fallback chain`, {
        label,
        removed: normalizedChain.length - filteredChain.length,
        remaining: filteredChain.length,
      })
    }
    // Normalize empty chain to undefined so downstream "no chain declared"
    // and "empty chain declared" stay semantically distinct.
    holder.fallback_models = filteredChain.length === 0 ? undefined : filteredChain
  }

  if (typeof holder.model === "string" && isProviderDisabled(holder.model, disabled)) {
    const replacement = findFirstAllowedReplacement(
      normalizeFallbackModels(holder.fallback_models),
      disabled,
    )
    if (replacement) {
      log(`[${HOOK_NAME}] Substituted primary model from fallback chain`, {
        label,
        from: holder.model,
        to: replacement,
      })
      holder.model = replacement
    } else {
      // Surface to the user-facing config-error channel so this does not
      // hide as a runtime ProviderModelNotFoundError on first delegation.
      const message =
        `${label} primary model "${holder.model}" uses a disabled provider and no allowed entry is available in fallback_models. ` +
        `Either remove the provider from disabled_providers or add an allowed entry to fallback_models.`
      addConfigLoadError({ path: `disabled_providers:${label}`, error: message })
      log(`[${HOOK_NAME}] ${message}`, { label, primary: holder.model })
    }
  }
}

/**
 * Filters `disabled_providers`-listed entries out of every agent/category
 * fallback chain and substitutes any primary `model` referencing a disabled
 * provider with the first allowed entry from the same chain.
 *
 * Returns the same config reference (mutated in place). Safe to call when
 * `disabled_providers` is unset or empty - it becomes a no-op.
 */
export function applyDisabledProviders(config: OhMyOpenCodeConfig): OhMyOpenCodeConfig {
  const disabled = config.disabled_providers ?? []
  if (disabled.length === 0) return config

  if (config.agents) {
    for (const [name, agentConfig] of Object.entries(config.agents)) {
      if (agentConfig && typeof agentConfig === "object") {
        applyToHolder(`agents.${name}`, agentConfig as ModelHolder, disabled)
      }
    }
  }

  if (config.categories) {
    for (const [name, categoryConfig] of Object.entries(config.categories)) {
      if (categoryConfig && typeof categoryConfig === "object") {
        applyToHolder(`categories.${name}`, categoryConfig as ModelHolder, disabled)
      }
    }
  }

  return config
}
