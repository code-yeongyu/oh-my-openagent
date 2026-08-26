import type { SenpiExtensionAPI } from "../../extension/types"

const REQUIRED_MEMORY_CAPABILITIES = ["appendEntry", "registerEntryRenderer"] as const

export type MissingMemoryCapability = (typeof REQUIRED_MEMORY_CAPABILITIES)[number]

export interface MemoryExtensionAPI extends SenpiExtensionAPI {
  appendEntry<T = unknown>(customType: string, data?: T): void
  registerEntryRenderer(customType: string, renderer: unknown): void
}

export function missingMemoryCapabilities(pi: SenpiExtensionAPI): MissingMemoryCapability[] {
  return REQUIRED_MEMORY_CAPABILITIES.filter(
    (capability) => typeof Reflect.get(pi, capability) !== "function",
  )
}

export function hasMemoryCapabilities(pi: SenpiExtensionAPI): pi is MemoryExtensionAPI {
  return missingMemoryCapabilities(pi).length === 0
}
