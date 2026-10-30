import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { DEFAULT_CATEGORIES } from "./builtins"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { missingChainProviders, parseAvailableModels, resolveAvailableCategoryNames, unlistedProviderModel } from "./resolver"
import type { SenpiModelPort, SenpiModelRegistryPort } from "./types"

export type UnusableCategory = {
  readonly name: string
  // The chain providers with no model in the registry, in chain order: the ones a /login would fix.
  readonly providers: readonly string[]
  // The `provider/id` an unlisted gateway or proxy serves for this category: the opt-in pin (#9146).
  readonly unlistedProviderModel?: string
}

export type CategoryCoverage = {
  readonly usable: readonly string[]
  readonly unusable: readonly UnusableCategory[]
}

/**
 * Which task categories this registry can serve, by the same gate the spawn path applies
 * (resolveAvailableCategoryNames), and for each one it cannot, the chain providers the
 * category-unavailable notice would name. A disabled category is neither usable nor a gap.
 * Throws on a registry whose model list is not an array: the gated resolver would silently list
 * every category there, which is not a coverage answer.
 */
export function resolveCategoryCoverage<TModel extends SenpiModelPort>(
  config: OmoConfig,
  registry: SenpiModelRegistryPort<TModel>,
): CategoryCoverage {
  const available = parseAvailableModels(registry.getAvailable())
  if (!available.validContainer) throw new Error("the model registry did not return a model list")
  const userCategories = config.categories ?? {}
  const enabled = (name: string): boolean => !Object.hasOwn(userCategories, name) || userCategories[name]?.disable !== true
  const usable = new Set(resolveAvailableCategoryNames(config, registry))
  const names = Array.from(new Set([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(userCategories)])).sort().filter(enabled)
  return {
    usable: names.filter((name) => usable.has(name)),
    unusable: names.filter((name) => !usable.has(name)).map((name) => {
      const chain = Object.hasOwn(CATEGORY_FALLBACK_CHAINS, name) ? CATEGORY_FALLBACK_CHAINS[name] : []
      const optIn = unlistedProviderModel(chain, available.models)
      return {
        name,
        providers: missingChainProviders(chain, available.models),
        ...(optIn !== undefined ? { unlistedProviderModel: optIn } : {}),
      }
    }),
  }
}
