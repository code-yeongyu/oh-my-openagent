import type { ToolDefinition } from "@code-yeongyu/senpi"

import type { SenpiExtensionAPI } from "./types"

export interface ToolCaptureRegistry {
  // All full ToolDefinitions (with their live execute closures) registered by any omo component while
  // the wrapper is installed. Returned newest-last; callers filter before sharing with children.
  getCapturedTools(): readonly ToolDefinition[]
  // End the omo component-registration window so senpi builtins loaded after this extension are not
  // mistaken for parent-owned tools and injected raw into an in-process child.
  stopCapture(): void
}

function isCapturableTool(value: unknown): value is ToolDefinition {
  if (typeof value !== "object" || value === null) return false
  const name = Reflect.get(value, "name")
  const execute = Reflect.get(value, "execute")
  return typeof name === "string" && typeof execute === "function"
}

/**
 * Install a capture wrapper around `pi.registerTool` (plan-reviewer finding: `pi.getAllTools()` returns ToolInfo
 * WITHOUT an execute closure, so the only place to grab an executable ToolDefinition is registration
 * time). Every full definition any component registers - lsp registers earlier in the loop than task
 * - is recorded here with its closure and exposed to the shared-parent-tools provider.
 */
export function installToolCaptureRegistry(pi: SenpiExtensionAPI): ToolCaptureRegistry {
  const captured: ToolDefinition[] = []
  const originalRegisterTool = pi.registerTool.bind(pi)
  const captureRegisterTool = (tool: Record<string, unknown>): void => {
    if (isCapturableTool(tool)) captured.push(tool)
    originalRegisterTool(tool)
  }
  pi.registerTool = captureRegisterTool
  return {
    getCapturedTools: () => captured,
    stopCapture() {
      if (pi.registerTool === captureRegisterTool) pi.registerTool = originalRegisterTool
    },
  }
}
