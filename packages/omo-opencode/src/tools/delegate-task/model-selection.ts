import {
  resolveModelForDelegateTask as resolveModelForDelegateTaskCore,
  type DelegateModelResolutionInput,
  type DelegateModelResolutionResult,
} from "@oh-my-opencode/delegate-core"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as exhaustedProvidersCache from "../../shared/exhausted-providers-cache"
import { log } from "../../shared/logger"

export type { DelegateModelResolutionInput, DelegateModelResolutionResult }

function filterExhaustedProviders(providers: readonly string[] | null): readonly string[] | null {
  if (!providers) return null
  const exhausted = exhaustedProvidersCache.getExhaustedProviderIDs()
  if (exhausted.length === 0) return providers
  const exhaustedSet = new Set(exhausted.map((providerID) => providerID.toLowerCase()))
  return providers.filter((providerID) => !exhaustedSet.has(providerID.toLowerCase()))
}

export function resolveModelForDelegateTask(input: DelegateModelResolutionInput): DelegateModelResolutionResult {
  const connectedProviders = input.availableModels.size === 0
    ? filterExhaustedProviders(connectedProvidersCache.readConnectedProvidersCache())
    : null

  return resolveModelForDelegateTaskCore(input, {
    connectedProviders,
    hasProviderModelsCache: connectedProvidersCache.hasProviderModelsCache(),
    hasConnectedProvidersCache: connectedProvidersCache.hasConnectedProvidersCache(),
    log,
  })
}
