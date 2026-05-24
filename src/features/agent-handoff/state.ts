import { getAgentConfigKey } from "../../shared/agent-display-names"

const lastObservedAgent = new Map<string, string>()

/**
 * Records the agent observed for this session on this turn and reports whether
 * it represents a transition from the previously observed agent.
 *
 * Returns the prior agent's display name when a transition is detected,
 * undefined otherwise (first turn of the session, or same agent as last turn).
 *
 * Comparison is normalized via getAgentConfigKey so display variants like
 * "Hephaestus - Deep Agent" and "hephaestus" are treated as the same agent.
 *
 * This is intentionally separate from setSessionAgent / getSessionAgent in
 * claude-code-session-state — that map is first-write-wins (it represents the
 * session's primary agent), and several callers depend on that semantics.
 */
export function recordAgentObservation(
  sessionID: string,
  currentAgent: string,
): string | undefined {
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
}

export function _resetAllForTests(): void {
  lastObservedAgent.clear()
}
