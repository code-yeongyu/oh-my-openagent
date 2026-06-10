import type { ToolDefinition } from "@opencode-ai/plugin"

export function filterDisabledTools(
  tools: Record<string, ToolDefinition>,
  disabledTools: readonly string[] | undefined
): Record<string, ToolDefinition> {
  if (!disabledTools || disabledTools.length === 0) {
    return tools
  }

  const disabledToolSet = new Set(disabledTools)
  const filtered: Record<string, ToolDefinition> = {}
  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    if (!disabledToolSet.has(toolName)) {
      filtered[toolName] = toolDefinition
    }
  }
  return filtered
}
