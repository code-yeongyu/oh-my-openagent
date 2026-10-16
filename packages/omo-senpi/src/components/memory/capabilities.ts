import type { SenpiExtensionAPI } from "../../extension/types"

const REQUIRED_MEMORY_CAPABILITIES = ["appendEntry", "registerEntryRenderer"] as const

export type MissingMemoryCapability = (typeof REQUIRED_MEMORY_CAPABILITIES)[number]

export interface MemoryExtensionAPI extends SenpiExtensionAPI {
  /** `options.startupBookkeeping` (senpi#3329): older hosts ignore the third argument. */
  appendEntry<T = unknown>(customType: string, data?: T, options?: { readonly startupBookkeeping?: boolean }): void
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
