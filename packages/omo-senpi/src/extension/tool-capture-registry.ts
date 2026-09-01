import type { ToolDefinition } from "@code-yeongyu/senpi"

import type { SenpiExtensionAPI } from "./types"

export interface ToolCaptureRegistry {
  // All full ToolDefinitions (with their live execute closures) registered by any omo component after
  // the wrapper was installed. Returned newest-last; callers filter before sharing with children.
  getCapturedTools(): readonly ToolDefinition[]
}

function isCapturableTool(value: unknown): value is ToolDefinition {
  if (typeof value !== "object" || value === null) return false
  const name = Reflect.get(value, "name")
  const execute = Reflect.get(value, "execute")
  return typeof name === "string" && typeof execute === "function"
}

/**
 * Install a capture wrapper around `pi.registerTool` (Momus fix: `pi.getAllTools()` returns ToolInfo
 * WITHOUT an execute closure, so the only place to grab an executable ToolDefinition is registration
 * time). Every full definition any component registers - lsp registers earlier in the loop than task
 * - is recorded here with its closure and exposed to the shared-parent-tools provider.
 */
export function installToolCaptureRegistry(pi: SenpiExtensionAPI): ToolCaptureRegistry {
  const captured: ToolDefinition[] = []
  const originalRegisterTool = pi.registerTool.bind(pi)
  pi.registerTool = (tool: Record<string, unknown>): void => {
    if (isCapturableTool(tool)) captured.push(tool)
    originalRegisterTool(tool)
  }
  return {
    getCapturedTools: () => captured,
  }
}
