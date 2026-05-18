export function touchSession(sessionLastAccess: Map<string, number>, sessionID: string): void {
  sessionLastAccess.set(sessionID, Date.now())
}

export function evictLeastRecentlyUsedSession(
  readPermissionsBySession: Map<string, Set<string>>,
  sessionLastAccess: Map<string, number>,
): void {
  let oldestSessionID: string | undefined
  let oldestSeen = Number.POSITIVE_INFINITY

  for (const [sessionID, lastSeen] of sessionLastAccess.entries()) {
    if (lastSeen < oldestSeen) {
      oldestSeen = lastSeen
      oldestSessionID = sessionID
    }
  }

  if (!oldestSessionID) {
    return
  }

  readPermissionsBySession.delete(oldestSessionID)
  sessionLastAccess.delete(oldestSessionID)
}

export function trimSessionReadSet(readSet: Set<string>, maxTrackedPathsPerSession: number): void {
  while (readSet.size > maxTrackedPathsPerSession) {
    const oldestPath = readSet.values().next().value
    if (!oldestPath) {
      return
    }

    readSet.delete(oldestPath)
  }
}
