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

export interface SessionModel {
  providerID: string
  modelID: string
}

const sessionModelMap = new Map<string, SessionModel>()

export function setSessionModel(sessionID: string, model: SessionModel): void {
  if (!sessionModelMap.has(sessionID)) {
    sessionModelMap.set(sessionID, model)
  }
}

export function updateSessionModel(sessionID: string, model: SessionModel): void {
  sessionModelMap.set(sessionID, model)
}

export function getSessionModel(sessionID: string): SessionModel | undefined {
  return sessionModelMap.get(sessionID)
}

export function clearSessionModel(sessionID: string): void {
  sessionModelMap.delete(sessionID)
}
