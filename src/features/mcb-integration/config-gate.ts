import type { McbConfig } from "../../config/schema/mcb"
import type { McbToolAvailability } from "./types"
import { lockMcbAvailability, markMcbUnavailable, resetMcbAvailability } from "./availability"

export function initializeMcbFromConfig(mcbConfig?: McbConfig): void {
  resetMcbAvailability()

  if (!mcbConfig?.enabled) {
    markMcbUnavailable()
    lockMcbAvailability()
    return
  }

  if (mcbConfig.tools) {
    const toolKeys: (keyof McbToolAvailability)[] = ["search", "memory", "index", "validate", "vcs", "session"]
    for (const key of toolKeys) {
      if (mcbConfig.tools[key] === false) {
        markMcbUnavailable(key)
      }
    }
  }

  lockMcbAvailability()
}
