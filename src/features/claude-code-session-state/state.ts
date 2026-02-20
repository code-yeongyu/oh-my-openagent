export const subagentSessions = new Set<string>()
export const syncSubagentSessions = new Set<string>()

let _mainSessionID: string | undefined

export function setMainSession(id: string | undefined) {
  _mainSessionID = id
}

export function getMainSessionID(): string | undefined {
  return _mainSessionID
}

/** @internal For testing only */
export function _resetForTesting(): void {
  _mainSessionID = undefined
  subagentSessions.clear()
  syncSubagentSessions.clear()
  sessionAgentMap.clear()
  pinnedSessionAgentMap.clear()
}

const sessionAgentMap = new Map<string, string>()

/**
 * Pinned session agents — set by explicit commands like /start-work.
 * These take precedence over regular sessionAgentMap to prevent SDK events
 * from overwriting deliberately set agents.
 */
const pinnedSessionAgentMap = new Map<string, string>()

export function setSessionAgent(sessionID: string, agent: string): void {
  if (!sessionAgentMap.has(sessionID)) {
    sessionAgentMap.set(sessionID, agent)
  }
}

/**
 * Pin an agent for a session — takes precedence over SDK-updated agents.
 * Use this for explicit agent switches (e.g., /start-work) that should
 * not be overwritten by SDK message.updated events.
 */
export function pinSessionAgent(sessionID: string, agent: string): void {
  pinnedSessionAgentMap.set(sessionID, agent)
  sessionAgentMap.set(sessionID, agent)
}

/**
 * Unpin an agent for a session — reverts to regular sessionAgentMap behavior.
 */
export function unpinSessionAgent(sessionID: string): void {
  pinnedSessionAgentMap.delete(sessionID)
}

export function updateSessionAgent(sessionID: string, agent: string): void {
  sessionAgentMap.set(sessionID, agent)
}

export function getSessionAgent(sessionID: string): string | undefined {
  return pinnedSessionAgentMap.get(sessionID) ?? sessionAgentMap.get(sessionID)
}

export function clearSessionAgent(sessionID: string): void {
  sessionAgentMap.delete(sessionID)
  pinnedSessionAgentMap.delete(sessionID)
}
