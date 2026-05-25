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
  const trimmed = toolName.trim()
  const lower = trimmed.toLowerCase()
  if (lower in SPECIAL_TOOL_MAPPINGS) {
    return SPECIAL_TOOL_MAPPINGS[lower]
  }

  if (trimmed.includes("-") || trimmed.includes("_")) {
    return toPascalCase(trimmed)
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
