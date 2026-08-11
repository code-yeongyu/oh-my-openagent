import type { OmpExtensionAPI } from "../../types"

const REQUIRED_MEMORY_CAPABILITIES = ["appendEntry", "registerEntryRenderer"] as const

export type MissingMemoryCapability = (typeof REQUIRED_MEMORY_CAPABILITIES)[number]

export interface MemoryExtensionAPI extends OmpExtensionAPI {
  appendEntry<T = unknown>(customType: string, data?: T): void
  registerEntryRenderer(customType: string, renderer: unknown): void
}

export function missingMemoryCapabilities(pi: OmpExtensionAPI): MissingMemoryCapability[] {
  return REQUIRED_MEMORY_CAPABILITIES.filter(
    (capability) => typeof Reflect.get(pi, capability) !== "function",
  )
}

export function hasMemoryCapabilities(pi: OmpExtensionAPI): pi is MemoryExtensionAPI {
  return missingMemoryCapabilities(pi).length === 0
}
