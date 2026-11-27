import { resolveModelForDelegateTask, type DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { canonicalCategoryName } from "@oh-my-opencode/omo-config-core"

import { availableChainCandidates, type ModelChainCandidate } from "../model-chain"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { parseAvailableModels } from "./registry-models"
import type { SenpiModelPort, SenpiModelRegistryPort } from "./types"

// Chain providers with no model in the live registry, in chain order, deduplicated.
export function missingChainProviders(
  chain: readonly DelegateFallbackEntry[],
  availableModels: readonly string[],
): readonly string[] {
  const connected = new Set(availableModels.map((model) => model.slice(0, model.indexOf("/"))))
  const missing: string[] = []
  for (const rung of chain) {
    for (const provider of rung.providers) {
      if (!connected.has(provider) && !missing.includes(provider)) missing.push(provider)
    }
  }
  return missing
}

// The first rung model, in chain order, that only an unlisted provider (a gateway or custom proxy)
// serves. Builtin resolution never selects it; it is the exact pin a user may opt into (#9146).
export function unlistedProviderModel(
  chain: readonly DelegateFallbackEntry[],
  availableModels: readonly string[],
): string | undefined {
  const available = new Set(availableModels)
  for (const rung of chain) {
    const match = resolveModelForDelegateTask(
      { fallbackChain: [rung], allowUnlistedProviders: true, availableModels: available },
      { connectedProviders: null, hasProviderModelsCache: true, hasConnectedProvidersCache: true },
    )
    if (match !== undefined && "model" in match) return match.model
  }
  return undefined
}

/**
 * The builtin fallback chain of a category, resolved against the models the registry reports as
 * available, in chain order. `resolveCategory` leaves a user-forced model's chain untouched; a
 * background child that must not die with its one refused pin appends these rungs itself.
 */
export function builtinCategoryChainCandidates<TModel extends SenpiModelPort>(
  requestedCategoryName: string,
  senpiModelRegistry: SenpiModelRegistryPort<TModel>,
): readonly ModelChainCandidate[] {
  const name = canonicalCategoryName(requestedCategoryName)
  const chain = Object.hasOwn(CATEGORY_FALLBACK_CHAINS, name) ? CATEGORY_FALLBACK_CHAINS[name] : undefined
  if (chain === undefined) return []
  return availableChainCandidates(chain, new Set(parseAvailableModels(senpiModelRegistry.getAvailable()).models))
}
