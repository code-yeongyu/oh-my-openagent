import type {
  ChildModelRegistry,
  SenpiModelPort,
  SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

export type { ChildModelRegistry }

/**
 * The settle-time model registry snapshot: the CONCRETE senpi ModelRegistry off the live ctx, not
 * a structural port. An in-process child session threads this exact instance into
 * createAgentSession, where senpi needs the real class (auth storage, model runtime, dynamic
 * providers) - a narrowed port could not cross that boundary, and sharing the instance is what
 * makes engine skew between the parent and the judge impossible.
 */
export function resolveMemoryModelRegistry(eventContext: unknown): ChildModelRegistry | undefined {
  if (!isRecord(eventContext)) return undefined
  const registry = eventContext.modelRegistry
  return isModelRegistry(registry) ? registry : undefined
}

/**
 * Copy the model lookup data needed by detached reflection before the host invalidates its live
 * extension context. The concrete registry remains available separately for in-process children,
 * which require its auth/runtime methods and never use this detached port.
 */
export function snapshotMemoryModelRegistry(
  registry: ChildModelRegistry | undefined,
): SenpiModelRegistryPort<SenpiModelPort> | undefined {
  if (registry === undefined) return undefined
  const all = registry.getAll()
  const available = registry.getAvailable()
  const bySelector = new Map(all.map((model) => [`${model.provider}/${model.id}`, model] as const))
  return {
    getAvailable: () => available,
    find: (provider, modelId) => bySelector.get(`${provider}/${modelId}`),
  }
}

function isModelRegistry(value: unknown): value is ChildModelRegistry {
  return isRecord(value) && typeof value.find === "function" && typeof value.getProviderAuth === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
