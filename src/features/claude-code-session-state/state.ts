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
  sessionModelMap.clear()
}

const sessionAgentMap = new Map<string, string>()
const sessionModelMap = new Map<string, { providerID: string; modelID: string }>()

export function setSessionAgent(sessionID: string, agent: string): void {
  if (!sessionAgentMap.has(sessionID)) {
    sessionAgentMap.set(sessionID, agent)
  }
}

export function setSessionModel(sessionID: string, model: { providerID: string; modelID: string }): void {
  sessionModelMap.set(sessionID, model)
}

export function getSessionModel(sessionID: string): { providerID: string; modelID: string } | undefined {
  return sessionModelMap.get(sessionID)
}

export function clearSessionModel(sessionID: string): void {
  sessionModelMap.delete(sessionID)
}

export function updateSessionAgent(sessionID: string, agent: string): void {
  sessionAgentMap.set(sessionID, agent)
}

export function getSessionAgent(sessionID: string): string | undefined {
  return sessionAgentMap.get(sessionID)
}

export function clearSessionAgent(sessionID: string): void {
  sessionAgentMap.delete(sessionID)
}
