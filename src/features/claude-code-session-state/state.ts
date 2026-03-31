import { getAgentConfigKey } from "../../shared/agent-display-names"

export const subagentSessions = new Set<string>()
export const syncSubagentSessions = new Set<string>()

let _mainSessionID: string | undefined

export function setMainSession(id: string | undefined) {
  _mainSessionID = id
}

export function getMainSessionID(): string | undefined {
  return _mainSessionID
}

const registeredAgentNames = new Set<string>()

export function registerAgentName(name: string): void {
  const normalizedName = name.toLowerCase()
  registeredAgentNames.add(normalizedName)

  const configKey = getAgentConfigKey(name).toLowerCase()
  if (configKey !== normalizedName) {
    registeredAgentNames.add(configKey)
  }
}

export function isAgentRegistered(name: string): boolean {
  return registeredAgentNames.has(name.toLowerCase())
}

/** @internal For testing only */
export function _resetForTesting(): void {
  _mainSessionID = undefined
  subagentSessions.clear()
  syncSubagentSessions.clear()
  sessionAgentMap.clear()
  registeredAgentNames.clear()
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
