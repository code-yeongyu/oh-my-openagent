const activeBtwTurnSessions = new Set<string>()

export function markBtwTurnActive(sessionID: string): void {
  if (sessionID.length === 0) {
    return
  }

  activeBtwTurnSessions.add(sessionID)
}

export function clearBtwTurnActive(sessionID: string): void {
  activeBtwTurnSessions.delete(sessionID)
}

export function isBtwTurnActive(sessionID: string): boolean {
  return activeBtwTurnSessions.has(sessionID)
}

export function _resetBtwTurnStateForTesting(): void {
  activeBtwTurnSessions.clear()
}
