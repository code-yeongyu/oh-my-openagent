import type { TaskModelRegistry } from "../task/planner"

/**
 * Senpi's `ExtensionContext.modelRegistry` satisfies the registry port structurally. An untyped
 * context (older host, RPC surface, unit test) yields undefined, and the caller then ships no
 * category snapshot rather than one that guessed model availability.
 */
export function resolveSessionModelRegistry(eventCtx: unknown): TaskModelRegistry | undefined {
  if (!isRecord(eventCtx)) return undefined
  const registry = eventCtx.modelRegistry
  if (!isRecord(registry)) return undefined
  const getAvailable = registry.getAvailable
  const find = registry.find
  if (typeof getAvailable !== "function" || typeof find !== "function") return undefined
  return {
    getAvailable: () => Reflect.apply(getAvailable, registry, []),
    find: (provider, modelId) => Reflect.apply(find, registry, [provider, modelId]),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
