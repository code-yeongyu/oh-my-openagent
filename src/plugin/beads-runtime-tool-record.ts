import type { ToolDefinition } from "@opencode-ai/plugin"

import type { BeadsRuntimeFeature } from "../features/beads-runtime"
import { createBeadsRuntimeTools } from "../tools"

export function createBeadsRuntimeToolRecord(
  beadsRuntime?: BeadsRuntimeFeature,
  directory?: string,
): Record<string, ToolDefinition> {
  if (!beadsRuntime?.activation.enabled || !directory) {
    return {}
  }

  return createBeadsRuntimeTools({
    beadsRuntime,
    directory,
  })
}
