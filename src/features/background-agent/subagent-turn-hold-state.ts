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

/**
 * Returns the turn state for the given session, creating it on first access.
 *
 * @param sessionID - The session identifier
 * @returns The existing or newly created turn state
 */
function getTurnState(sessionID: string): TurnHoldState {
  const stateMap = getHoldStateMap()
  if (!stateMap.has(sessionID)) {
    stateMap.set(sessionID, {
      seenSubagentTypes: new Set(),
    })
  }
  return stateMap.get(sessionID)!
}

/**
 * Records a subagent type in the current turn state for the given session.
 * The subagent type is stored in lowercase.
 *
 * @param sessionID - The session identifier
 * @param subagentType - The subagent type to record (will be normalized to lowercase)
 */
export function markSubagentTypeInTurn(sessionID: string, subagentType: string): void {
  const state = getTurnState(sessionID)
  state.seenSubagentTypes.add(subagentType.toLowerCase())
}

/**
 * Checks if a 'plan' subagent type has been recorded in the current turn for the given session.
 *
 * @param sessionID - The session identifier
 * @returns true if 'plan' is in the recorded subagent types, false otherwise
 */
export function hasPlanInCurrentTurn(sessionID: string): boolean {
  const stateMap = getHoldStateMap()
  const state = stateMap.get(sessionID)
  if (!state) {
    return false
  }
  return state.seenSubagentTypes.has("plan")
}


/**
 * Clears all turn state for the given session.
 *
 * @param sessionID - The session identifier
 */
export function clearTurnState(sessionID: string): void {
  const stateMap = getHoldStateMap()
  stateMap.delete(sessionID)
}

/**
 * Clears all turn hold state for testing purposes.
 * This should only be used in tests.
 */
export function clearAllTurnHoldStateForTesting(): void {
  const stateMap = getHoldStateMap()
  stateMap.clear()
}
