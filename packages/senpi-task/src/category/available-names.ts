import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { DEFAULT_CATEGORIES, isCategoryChainViable, isCategoryGateSatisfied } from "./builtins"
import { withoutExcludedModels } from "../model-exclusion"
import { parseAvailableModels } from "./registry-models"
import type { SenpiModelPort, SenpiModelRegistryPort } from "./types"

export function availableCategoryNames(config: OmoConfig, availableModels?: ReadonlySet<string>): readonly string[] {
  const names = Array.from(new Set([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(config.categories ?? {})])).sort()
  if (availableModels === undefined) return names
  const userCategories = config.categories ?? {}
  return names.filter((name) => {
    const hasExplicitUserConfig = Object.hasOwn(userCategories, name) && userCategories[name] !== undefined
    return isCategoryGateSatisfied(name, hasExplicitUserConfig, availableModels)
      && isCategoryChainViable(name, hasExplicitUserConfig, availableModels)
  })
}

// Gated listing for the disabled/not_found early returns. The registry is only consulted best
// effort here: a throwing or malformed registry degrades to the ungated list (today's behavior),
// since those results never resolve a model anyway.
export function gatedAvailableCategories<TModel extends SenpiModelPort>(
  config: OmoConfig,
  senpiModelRegistry: SenpiModelRegistryPort<TModel>,
): readonly string[] {
  try {
    const parsed = parseAvailableModels(withoutExcludedModels(senpiModelRegistry, config.exclude_models).getAvailable())
    if (!parsed.validContainer) return availableCategoryNames(config)
    return availableCategoryNames(config, new Set(parsed.models))
  } catch {
    return availableCategoryNames(config)
  }
}

export function resolveAvailableCategoryNames<TModel extends SenpiModelPort>(
  config: OmoConfig,
  senpiModelRegistry: SenpiModelRegistryPort<TModel>,
): readonly string[] {
  return gatedAvailableCategories(config, senpiModelRegistry)
}
