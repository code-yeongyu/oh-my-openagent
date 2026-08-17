const HOLD_STATE_KEY = "__omoSubagentTurnHoldState"

interface TurnHoldState {
  seenSubagentTypes: Set<string>
}

type GlobalWithHoldState = typeof globalThis & {
  [HOLD_STATE_KEY]?: Map<string, TurnHoldState>
}

function getHoldStateMap(): Map<string, TurnHoldState> {
  const global = globalThis as GlobalWithHoldState
  global[HOLD_STATE_KEY] ??= new Map()
  return global[HOLD_STATE_KEY]!
}

export function markSubagentTypeInTurn(sessionID: string, subagentType: string): void {
  const state = getHoldStateMap().get(sessionID) ?? { seenSubagentTypes: new Set<string>() }
  state.seenSubagentTypes.add(subagentType.trim().toLowerCase())
  getHoldStateMap().set(sessionID, state)
}

export function hasPlanInCurrentTurn(sessionID: string): boolean {
  return getHoldStateMap().get(sessionID)?.seenSubagentTypes.has("plan") ?? false
}

export function clearTurnState(sessionID: string): void {
  getHoldStateMap().delete(sessionID)
}

export function clearAllTurnHoldStateForTesting(): void {
  getHoldStateMap().clear()
}
