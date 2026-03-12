export const subagentSessions = new Set<string>()
export const syncSubagentSessions = new Set<string>()
export const teamLeaderSessions = new Set<string>()
export const teamWorkerSessions = new Set<string>()

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
  teamLeaderSessions.clear()
  teamWorkerSessions.clear()
  sessionAgentMap.clear()
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

export function registerTeamLeaderSession(sessionID: string): void {
  teamWorkerSessions.delete(sessionID)
  teamLeaderSessions.add(sessionID)
}

export function registerTeamWorkerSession(sessionID: string): void {
  teamLeaderSessions.delete(sessionID)
  teamWorkerSessions.add(sessionID)
}

export function getTeamSessionRole(sessionID: string): "leader" | "worker" | null {
  if (teamLeaderSessions.has(sessionID)) {
    return "leader"
  }

  if (teamWorkerSessions.has(sessionID)) {
    return "worker"
  }

  return null
}

export function clearTeamSession(sessionID: string): void {
  teamLeaderSessions.delete(sessionID)
  teamWorkerSessions.delete(sessionID)
}
