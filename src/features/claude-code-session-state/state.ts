export const subagentSessions = new Set<string>()

export let mainSessionID: string | undefined

export function setMainSession(id: string | undefined) {
  mainSessionID = id
}

export function getMainSessionID(): string | undefined {
  return mainSessionID
}

const sessionAgentMap = new Map<string, string>()

export function setSessionAgent(sessionID: string, agent: string): void {
  if (!sessionAgentMap.has(sessionID)) {
    sessionAgentMap.set(sessionID, agent)
  }
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
