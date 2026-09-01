/**
 * Parses a tools configuration value into a boolean record.
 * Accepts comma-separated strings, string arrays, or unknown values from config files.
 * Returns undefined when input is empty or invalid.
 */
export function parseToolsConfig(toolsValue: unknown): Record<string, boolean> | undefined {
  if (!toolsValue) return undefined

  let items: string[]
  if (typeof toolsValue === "string") {
    items = toolsValue.split(",").map((t) => t.trim()).filter(Boolean)
  } else if (Array.isArray(toolsValue)) {
    items = toolsValue.filter((t) => typeof t === "string" && t.trim().length > 0).map((t) => (t as string).trim())
  } else {
    return undefined
  }

  if (items.length === 0) return undefined

  const result: Record<string, boolean> = {}
  for (const tool of items) {
    result[tool.toLowerCase()] = true
  }
  return result
}
