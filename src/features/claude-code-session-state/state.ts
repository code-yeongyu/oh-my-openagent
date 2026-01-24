export const subagentSessions = new Set<string>()

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
  sessionAgentMap.clear()
  previousAgentMap.clear()
}

const sessionAgentMap = new Map<string, string>()
const previousAgentMap = new Map<string, string>()

export function setSessionAgent(sessionID: string, agent: string): void {
  if (!sessionAgentMap.has(sessionID)) {
    sessionAgentMap.set(sessionID, agent)
  }
}

export function updateSessionAgent(sessionID: string, agent: string): void {
  const currentAgent = sessionAgentMap.get(sessionID)
  if (currentAgent !== undefined && currentAgent !== agent) {
    previousAgentMap.set(sessionID, currentAgent)
  }
  sessionAgentMap.set(sessionID, agent)
}

export function getSessionAgent(sessionID: string): string | undefined {
  return sessionAgentMap.get(sessionID)
}

export function consumePreviousAgent(sessionID: string): string | undefined {
  const previous = previousAgentMap.get(sessionID)
  previousAgentMap.delete(sessionID)
  return previous
}

export function clearSessionAgent(sessionID: string): void {
  sessionAgentMap.delete(sessionID)
  previousAgentMap.delete(sessionID)
}
