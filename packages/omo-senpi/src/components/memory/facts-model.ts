import { isExcludedModel, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import { withoutExcludedModels, type SenpiModelPort, type SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"
import { parseAvailableModels } from "@oh-my-opencode/senpi-task/category-resolver"
import { resolveReflectionModel, type ReflectionModelResolution, type ReflectionSessionModel } from "./worker/resolve-model"

/** Facts may use only a user selection, never the built-in quick chain or registry ladder. */
export function resolveFactsModel(
  config: OmoConfig,
  liveRegistry: SenpiModelRegistryPort<SenpiModelPort> | undefined,
  liveSession: ReflectionSessionModel | undefined,
  identity: string,
): ReflectionModelResolution {
  // exclude_models applies here as everywhere else: an excluded configured model is not found and
  // an excluded session model is not inherited.
  const registry = liveRegistry === undefined ? undefined : withoutExcludedModels(liveRegistry, config.exclude_models)
  const session = liveSession !== undefined && isExcludedModel(`${liveSession.provider}/${liveSession.id}`, config.exclude_models) ? undefined : liveSession
  const configured = config.memory?.agents?.[identity]?.facts?.model ?? config.memory?.facts?.model
  const quick = config.categories?.quick
  const available = new Set(parseAvailableModels(registry?.getAvailable()).models)
  if (configured === undefined && quick?.disable === true) {
    return { kind: "category_unavailable", category: "quick", cause: "not_found" }
  }
  // Explicit quick settings are the existing facts-model configuration. Keep their declared
  // candidates, but strip built-in rungs that resolveReflectionModel adds for other workers.
  if (configured === undefined && quick !== undefined && (quick.model !== undefined || (quick.models?.length ?? 0) > 0)) {
    const resolution = resolveReflectionModel("quick", config, registry)
    if (resolution.kind !== "resolved" || resolution.source !== undefined) {
      return { kind: "category_unavailable", category: "quick", cause: "model_unavailable" }
    }
    const declared = new Set([
      ...(quick.model === undefined ? [] : [quick.model]),
      ...(quick.models ?? []).map((entry) => typeof entry === "string" ? entry : entry.model),
      ...(quick.fallback_models === undefined
        ? []
        : (Array.isArray(quick.fallback_models) ? quick.fallback_models : [quick.fallback_models])
            .map((entry) => typeof entry === "string" ? entry : entry.model)),
    ])
    if (!declared.has(resolution.model) || !available.has(resolution.model)) {
      return { kind: "category_unavailable", category: "quick", cause: "model_unavailable" }
    }
    return { ...resolution, fallbacks: resolution.fallbacks.filter((candidate) => declared.has(candidate.model)) }
  }
  const selector = configured ?? (session === undefined ? undefined : `${session.provider}/${session.id}`)
  if (registry === undefined || selector === undefined) {
    return { kind: "category_unavailable", category: "quick", cause: registry === undefined ? "no_registry" : "not_found" }
  }
  const separator = selector.indexOf("/")
  if (separator <= 0 || registry.find(selector.slice(0, separator), selector.slice(separator + 1)) === undefined) {
    return { kind: "category_unavailable", category: "quick", cause: "model_unavailable" }
  }
  if (!available.has(selector)) {
    return { kind: "category_unavailable", category: "quick", cause: "model_unavailable" }
  }
  return { kind: "resolved", category: "quick", model: selector, fallbacks: [] }
}
