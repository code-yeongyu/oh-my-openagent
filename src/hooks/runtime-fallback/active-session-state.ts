const activeRuntimeFallbackSessions = new Set<string>()

export function markRuntimeFallbackActive(sessionID: string): void {
  activeRuntimeFallbackSessions.add(sessionID)
}

export function clearRuntimeFallbackActive(sessionID: string): void {
  activeRuntimeFallbackSessions.delete(sessionID)
}

export function isRuntimeFallbackActive(sessionID: string): boolean {
  return activeRuntimeFallbackSessions.has(sessionID)
}

export function clearAllRuntimeFallbackActiveSessions(): void {
  activeRuntimeFallbackSessions.clear()
}
