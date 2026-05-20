type CommandSource = "claude-code" | "opencode"

export function sanitizeModelField(model: unknown, source: CommandSource = "claude-code"): string | undefined {
  if (source === "claude-code") {
    return undefined
  }
  
  if (typeof model === "string" && model.trim().length > 0) {
    return model.trim()
  }
  return undefined
}
