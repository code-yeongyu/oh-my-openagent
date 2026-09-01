import type { ModelRequirement } from "../../../shared/model-requirements"

function formatProviderChain(providers: string[]): string {
  return providers.join(" → ")
}

export function getEffectiveModel(requirement: ModelRequirement, userOverride?: string): string {
  if (userOverride) {
    return userOverride
  }
  const firstEntry = requirement.fallbackChain[0]
  if (!firstEntry) {
    return "unknown"
  }
  return `${firstEntry.providers[0]}/${firstEntry.model}`
}

export function buildEffectiveResolution(requirement: ModelRequirement, userOverride?: string): string {
  if (userOverride) {
    return `User override: ${userOverride}`
  }
  const firstEntry = requirement.fallbackChain[0]
  if (!firstEntry) {
    return "No fallback chain defined"
  }
  return `Provider fallback: ${formatProviderChain(firstEntry.providers)} → ${firstEntry.model}`
}
