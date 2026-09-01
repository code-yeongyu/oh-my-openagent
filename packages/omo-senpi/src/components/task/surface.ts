import type { SenpiExtensionAPI } from "../../extension/types"

// The extra ExtensionAPI surface the task component needs beyond the base omo-senpi requirements:
// sendMessage powers completion delivery and registerMessageRenderer powers the completion card. When
// either is absent the component skips registration with ONE warning instead of crashing startup.
const REQUIRED_TASK_CAPABILITIES = ["sendMessage", "registerMessageRenderer"] as const

export type MissingTaskCapability = (typeof REQUIRED_TASK_CAPABILITIES)[number]

export function missingTaskCapabilities(pi: SenpiExtensionAPI): MissingTaskCapability[] {
  return REQUIRED_TASK_CAPABILITIES.filter((capability) => typeof Reflect.get(pi, capability) !== "function")
}
