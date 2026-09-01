import type { ReflectionSessionModel } from "./worker"

export function resolveMemorySessionModel(eventContext: unknown): ReflectionSessionModel | undefined {
  if (!isRecord(eventContext)) return undefined
  const model = eventContext.model
  if (!isRecord(model)) return undefined
  const provider = model.provider
  const id = model.id
  if (typeof provider !== "string" || provider.length === 0) return undefined
  if (typeof id !== "string" || id.length === 0) return undefined
  return { provider, id }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
