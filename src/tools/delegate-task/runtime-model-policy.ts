import type { FallbackEntry } from "../../shared/model-requirements"
import { getModelProvider, isProviderDisabled } from "../../shared/disabled-providers"

export function validateRuntimeModelProvider(
  runtimeModel: string | undefined,
  disabledProviders: readonly string[] | undefined,
): string | undefined {
  if (!runtimeModel || !disabledProviders || disabledProviders.length === 0) return undefined
  if (!isProviderDisabled(runtimeModel, disabledProviders)) return undefined

  const provider = getModelProvider(runtimeModel)
  return provider
    ? `Runtime model override "${runtimeModel}" uses disabled provider "${provider}". Remove the model override or remove "${provider}" from disabled_providers.`
    : `Runtime model override "${runtimeModel}" uses a disabled provider. Remove the model override or update disabled_providers.`
}


export function isProviderNameDisabled(
  providerID: string | undefined,
  disabledProviders: readonly string[] | undefined,
): boolean {
  if (!providerID || !disabledProviders || disabledProviders.length === 0) return false

  const provider = providerID.trim().toLowerCase()
  if (!provider) return false

  return disabledProviders.some((entry) => entry.trim().toLowerCase() === provider)
}

export function isModelProviderDisabled(
  model: string | undefined,
  disabledProviders: readonly string[] | undefined,
): boolean {
  if (!model || !disabledProviders || disabledProviders.length === 0) return false
  return isProviderDisabled(model, disabledProviders)
}

export function filterDisabledProvidersFromFallbackChain(
  fallbackChain: readonly FallbackEntry[] | undefined,
  disabledProviders: readonly string[] | undefined,
): FallbackEntry[] | undefined {
  if (!fallbackChain) return undefined
  if (!disabledProviders || disabledProviders.length === 0) return [...fallbackChain]

  const filteredChain = fallbackChain
    .map((entry) => ({
      ...entry,
      providers: entry.providers.filter((provider) => !isProviderNameDisabled(provider, disabledProviders)),
    }))
    .filter((entry) => entry.providers.length > 0)

  return filteredChain.length > 0 ? filteredChain : undefined
}
