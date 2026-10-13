/** 2.x built-in tool names to the 1.x names the plugin's hooks and message readers match on. */
const V1_TOOL_NAMES: Readonly<Record<string, string>> = { shell: "bash", patch: "apply_patch" }

export function toV1ToolName(tool: string): string {
  return V1_TOOL_NAMES[tool] ?? tool
}
