import { isExcludedModel } from "@oh-my-opencode/omo-config-core"

import type { SenpiModelPort, SenpiModelRegistryPort } from "./category/types"

function modelKey(model: unknown): string | undefined {
  if (typeof model !== "object" || model === null) return undefined
  const provider: unknown = Reflect.get(model, "provider")
  const id: unknown = Reflect.get(model, "id")
  return typeof provider === "string" && typeof id === "string" ? `${provider}/${id}` : undefined
}

/**
 * The registry as `exclude_models` leaves it: an excluded model is neither available nor found, so
 * every chain walk (category, agent, builtin rung, memory child) skips it exactly as it skips a
 * model whose provider has no login. With no patterns the registry is returned unchanged.
 */
export function withoutExcludedModels<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  patterns: readonly string[] | undefined,
): SenpiModelRegistryPort<TModel> {
  if (patterns === undefined || patterns.length === 0) return registry
  return {
    getAvailable: () => {
      const available = registry.getAvailable()
      if (!Array.isArray(available)) return available
      return available.filter((model) => {
        const key = modelKey(model)
        return key === undefined || !isExcludedModel(key, patterns)
      })
    },
    find: (provider, modelId) => isExcludedModel(`${provider}/${modelId}`, patterns) ? undefined : registry.find(provider, modelId),
  }
}
