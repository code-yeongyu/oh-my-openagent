import { getAgentConfigKey } from "../../shared/agent-display-names"

const lastObservedAgent = new Map<string, string>()
const lastObservedMessageID = new Map<string, string>()

/**
 * Records the agent observed for this session on this turn and reports whether
 * it represents a transition from the previously observed agent.
 *
 * Returns the prior agent's display name when a transition is detected,
 * undefined otherwise (first turn of the session, same agent as last turn, or
 * a duplicate firing of chat.message for the same messageID).
 *
 * Comparison is normalized via getAgentConfigKey so display variants like
 * "Hephaestus - Deep Agent" and "hephaestus" are treated as the same agent.
 *
 * Why messageID dedup: opencode fires chat.message twice per user turn —
 * once with the user-selected agent (canonical), once a few ms later with
 * a session-default agent (internal, can't be told apart by other input).
 * Both firings share the same messageID. We only record the first one to
 * avoid emitting spurious transition markers in both directions on every
 * turn. If messageID is undefined (test mocks, edge cases), every call is
 * treated as a fresh turn and dedup is bypassed.
 *
 * This is intentionally separate from setSessionAgent / getSessionAgent in
 * claude-code-session-state — that map is first-write-wins (it represents the
 * session's primary agent), and several callers depend on that semantics.
 */
export function recordAgentObservation(
  sessionID: string,
  currentAgent: string,
  messageID?: string,
): string | undefined {
  if (messageID && lastObservedMessageID.get(sessionID) === messageID) {
    return undefined
  }
  if (messageID) {
    lastObservedMessageID.set(sessionID, messageID)
  }

  const prior = lastObservedAgent.get(sessionID)
  lastObservedAgent.set(sessionID, currentAgent)

  if (!prior) return undefined

  const priorKey = getAgentConfigKey(prior)
  const currentKey = getAgentConfigKey(currentAgent)
  if (priorKey === currentKey) return undefined

  return prior
}

export function clearAgentObservation(sessionID: string): void {
  lastObservedAgent.delete(sessionID)
  lastObservedMessageID.delete(sessionID)
}

export function _resetAllForTests(): void {
  lastObservedAgent.clear()
  lastObservedMessageID.clear()
}
