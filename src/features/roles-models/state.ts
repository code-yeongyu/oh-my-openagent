import type { ChainEntry } from "./types"

type SessionState = {
  overrides: Map<string, ChainEntry>
  budgetSpent: Map<string, number>
  autoPick?: boolean
}

const SESSIONS = new Map<string, SessionState>()

function getOrInit(sessionID: string): SessionState {
  let state = SESSIONS.get(sessionID)
  if (!state) {
    state = { overrides: new Map(), budgetSpent: new Map() }
    SESSIONS.set(sessionID, state)
  }
  return state
}

export function setOverride(sessionID: string, role: string, entry: ChainEntry): void {
  getOrInit(sessionID).overrides.set(role, entry)
}

export function clearOverride(sessionID: string, role: string): void {
  SESSIONS.get(sessionID)?.overrides.delete(role)
}

export function getOverride(sessionID: string, role: string): ChainEntry | undefined {
  return SESSIONS.get(sessionID)?.overrides.get(role)
}

export function tryConsumeBudget(sessionID: string, role: string, budget: number): boolean {
  const state = getOrInit(sessionID)
  const spent = state.budgetSpent.get(role) ?? 0
  if (spent >= budget) return false
  state.budgetSpent.set(role, spent + 1)
  return true
}

export function getBudgetSpent(sessionID: string, role: string): number {
  return SESSIONS.get(sessionID)?.budgetSpent.get(role) ?? 0
}

export function setAutoPick(sessionID: string, enabled: boolean): void {
  getOrInit(sessionID).autoPick = enabled
}

export function getAutoPickOverride(sessionID: string): boolean | undefined {
  return SESSIONS.get(sessionID)?.autoPick
}

export function resetSession(sessionID: string): void {
  SESSIONS.delete(sessionID)
}

export function _resetAllForTests(): void {
  SESSIONS.clear()
}
