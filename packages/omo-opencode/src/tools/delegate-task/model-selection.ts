import {
  resolveModelForDelegateTask as resolveModelForDelegateTaskCore,
  type DelegateModelResolutionInput,
  type DelegateModelResolutionResult,
} from "@oh-my-opencode/delegate-core"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { log } from "../../shared/logger"

export type { DelegateModelResolutionInput, DelegateModelResolutionResult }

export function resolveModelForDelegateTask(input: DelegateModelResolutionInput): DelegateModelResolutionResult {
  const connectedProviders = input.availableModels.size === 0
    ? connectedProvidersCache.readConnectedProvidersCache()
    : null

  return resolveModelForDelegateTaskCore(input, {
    connectedProviders,
    hasProviderModelsCache: connectedProvidersCache.hasProviderModelsCache(),
    hasConnectedProvidersCache: connectedProvidersCache.hasConnectedProvidersCache(),
    log,
  })
}
