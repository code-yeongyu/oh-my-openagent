export interface PendingHandoff {
  agent: string
  context: string
}

const pendingHandoffs = new Map<string, PendingHandoff>()

export function setPendingHandoff(sessionID: string, agent: string, context: string): void {
  pendingHandoffs.set(sessionID, { agent, context })
}

export function consumePendingHandoff(sessionID: string): PendingHandoff | undefined {
  const handoff = pendingHandoffs.get(sessionID)
  if (handoff) {
    pendingHandoffs.delete(sessionID)
  }
  return handoff
}

/** @internal For testing only */
export function _resetForTesting(): void {
  pendingHandoffs.clear()
}
