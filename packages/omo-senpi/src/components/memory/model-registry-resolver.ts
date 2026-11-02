import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

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

function isModelRegistry(value: unknown): value is ChildModelRegistry {
  return isRecord(value) && typeof value.find === "function" && typeof value.getProviderAuth === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
