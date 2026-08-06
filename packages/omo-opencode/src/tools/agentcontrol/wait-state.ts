type SessionWaitState = {
  readonly agentNames: Set<string>
  readonly dispatchGroups: Set<string>
}

const sessionWaits = new Map<string, SessionWaitState>()
const agentReportPattern = /^\[AGENT_REPORT ([a-z][a-z0-9_-]{0,31})(?:\s|\])/m

function stateFor(sessionID: string): SessionWaitState {
  const existing = sessionWaits.get(sessionID)
  if (existing) return existing
  const created = { agentNames: new Set<string>(), dispatchGroups: new Set<string>() }
  sessionWaits.set(sessionID, created)
  return created
}

function deleteIfEmpty(sessionID: string, state: SessionWaitState): void {
  if (state.agentNames.size === 0 && state.dispatchGroups.size === 0) sessionWaits.delete(sessionID)
}

export function markAgentControlAgent(sessionID: string, name: string): void {
  stateFor(sessionID).agentNames.add(name)
}

export function markAgentControlDispatch(sessionID: string, group: string): void {
  stateFor(sessionID).dispatchGroups.add(group)
}

export function clearAgentControlAgent(sessionID: string, name: string): void {
  const state = sessionWaits.get(sessionID)
  if (!state) return
  state.agentNames.delete(name)
  deleteIfEmpty(sessionID, state)
}

export function clearAgentControlAgentFromReport(sessionID: string, text: string): boolean {
  const name = text.match(agentReportPattern)?.[1]
  if (!name) return false
  clearAgentControlAgent(sessionID, name)
  return true
}

export function clearAgentControlDispatch(sessionID: string, group: string): void {
  const state = sessionWaits.get(sessionID)
  if (!state) return
  state.dispatchGroups.delete(group)
  deleteIfEmpty(sessionID, state)
}

export function hasPendingAgentControlWait(sessionID: string): boolean {
  return sessionWaits.has(sessionID)
}

export function resetAgentControlWaitStateForTesting(): void {
  sessionWaits.clear()
}
