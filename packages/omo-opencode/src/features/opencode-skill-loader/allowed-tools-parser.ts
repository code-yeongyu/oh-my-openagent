export function parseAllowedTools(allowedTools: string | string[] | undefined): string[] | undefined {
  if (!allowedTools) return undefined

  if (Array.isArray(allowedTools)) {
    return allowedTools.map((tool) => tool.trim()).filter(Boolean)
  }

  return allowedTools.split(/\s+/).filter(Boolean)
}
