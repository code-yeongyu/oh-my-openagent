import {
  filterDisabledProvidersFromFallbackChain as filterSharedDisabledProvidersFromFallbackChain,
  getModelProvider,
  isProviderDisabled,
  isProviderNameDisabled as isSharedProviderNameDisabled,
} from "../../shared/disabled-providers"

export {
  filterSharedDisabledProvidersFromFallbackChain as filterDisabledProvidersFromFallbackChain,
  isSharedProviderNameDisabled as isProviderNameDisabled,
}

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


export function isModelProviderDisabled(
  model: string | undefined,
  disabledProviders: readonly string[] | undefined,
): boolean {
  if (!model || !disabledProviders || disabledProviders.length === 0) return false
  return isProviderDisabled(model, disabledProviders)
}
