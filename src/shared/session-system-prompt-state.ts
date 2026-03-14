/**
 * Session system prompt state management.
 * Stores the system prompt for each session to preserve it during model fallbacks.
 */

const sessionSystemPrompts = new Map<string, string>()

export function setSessionSystemPrompt(sessionID: string, systemPrompt: string): void {
  sessionSystemPrompts.set(sessionID, systemPrompt)
}

export function getSessionSystemPrompt(sessionID: string): string | undefined {
  return sessionSystemPrompts.get(sessionID)
}

export function clearSessionSystemPrompt(sessionID: string): void {
  sessionSystemPrompts.delete(sessionID)
}
