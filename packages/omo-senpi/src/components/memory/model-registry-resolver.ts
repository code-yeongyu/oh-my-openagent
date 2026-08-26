import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

export function resolveMemoryModelRegistry(
  eventContext: unknown,
): SenpiModelRegistryPort<SenpiModelPort> | undefined {
  if (!isRecord(eventContext)) return undefined
  const registry = eventContext.modelRegistry
  return isModelRegistry(registry) ? registry : undefined
}

function isModelRegistry(value: unknown): value is SenpiModelRegistryPort<SenpiModelPort> {
  return isRecord(value) && typeof value.getAvailable === "function" && typeof value.find === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
