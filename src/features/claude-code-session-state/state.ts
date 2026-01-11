export const subagentSessions = new Set<string>()

export let mainSessionID: string | undefined

export function setMainSession(id: string | undefined) {
  mainSessionID = id
}

export function getMainSessionID(): string | undefined {
  return mainSessionID
}

/**
 * Session-to-agent mapping.
 * Tracks which agent is active for each session to prevent agent fallback issues.
 * This is critical for maintaining agent context during hook message injection.
 */
const sessionAgentMap = new Map<string, string>()

/**
 * Set the active agent for a session.
 * Called when a session starts or when agent context is detected.
 */
export function setSessionAgent(sessionID: string, agent: string): void {
  sessionAgentMap.set(sessionID, agent)
}

/**
 * Get the active agent for a session.
 * Returns undefined if no agent is tracked for this session.
 */
export function getSessionAgent(sessionID: string): string | undefined {
  return sessionAgentMap.get(sessionID)
}

/**
 * Clear the agent tracking for a session.
 * Called when a session ends.
 */
export function clearSessionAgent(sessionID: string): void {
  sessionAgentMap.delete(sessionID)
}
