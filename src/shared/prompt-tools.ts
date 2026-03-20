import { getSessionTools } from "./session-tools-store"

export type PromptToolPermission = boolean | "allow" | "deny" | "ask"

export function normalizePromptTools(
  tools: Record<string, PromptToolPermission> | undefined
): Record<string, boolean> | undefined {
  if (!tools) {
    return undefined
  }

  const normalized: Record<string, boolean> = {}
  for (const [toolName, permission] of Object.entries(tools)) {
    if (permission === false || permission === "deny") {
      normalized[toolName] = false
      continue
    }
    if (permission === true || permission === "allow" || permission === "ask") {
      normalized[toolName] = true
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function resolveInheritedPromptTools(
  sessionID: string,
  fallbackTools?: Record<string, PromptToolPermission>
): Record<string, boolean> | undefined {
  const sessionTools = getSessionTools(sessionID)
  if (sessionTools && Object.keys(sessionTools).length > 0) {
    return { ...sessionTools }
  }
  return normalizePromptTools(fallbackTools)
}
