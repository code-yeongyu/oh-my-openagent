const SPECIAL_TOOL_MAPPINGS: Record<string, string> = {
  webfetch: "WebFetch",
  websearch: "WebSearch",
  todoread: "TodoRead",
  todowrite: "TodoWrite",
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("")
}

export function transformToolName(toolName: string): string {
  const lower = toolName.toLowerCase()
  if (lower in SPECIAL_TOOL_MAPPINGS) {
    return SPECIAL_TOOL_MAPPINGS[lower]
  }

  if (toolName.includes("-") || toolName.includes("_")) {
    return toPascalCase(toolName)
  }

  return toolName.charAt(0).toUpperCase() + toolName.slice(1)
}
