/** Timeout in ms after which a stale council session lock is automatically released. */
const COUNCIL_SESSION_TIMEOUT_MS = 5 * 60 * 1000

/** Tracks active council executions per session with timestamps for stale entry cleanup. */
const activeCouncilSessions = new Map<string, number>()

function purgeStaleEntries(): void {
  const now = Date.now()
  for (const [sessionId, startedAt] of activeCouncilSessions) {
    if (now - startedAt > COUNCIL_SESSION_TIMEOUT_MS) {
      activeCouncilSessions.delete(sessionId)
    }
  }
}

export function isCouncilRunning(sessionId: string): boolean {
  purgeStaleEntries()
  return activeCouncilSessions.has(sessionId)
}

export function markCouncilRunning(sessionId: string): void {
  activeCouncilSessions.set(sessionId, Date.now())
}

export function markCouncilDone(sessionId: string): void {
  activeCouncilSessions.delete(sessionId)
}

/** Visible for testing only. */
export function _resetForTesting(): void {
  activeCouncilSessions.clear()
}

/** Visible for testing only. */
export function _setTimestampForTesting(sessionId: string, timestamp: number): void {
  activeCouncilSessions.set(sessionId, timestamp)
}
