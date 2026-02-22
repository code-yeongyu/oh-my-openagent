const sessionPlanMap = new Map<string, string>()

export function setSessionPlanName(sessionID: string, planName: string): void {
  if (!sessionPlanMap.has(sessionID)) {
    sessionPlanMap.set(sessionID, planName)
  }
}

export function getSessionPlanName(sessionID: string): string | undefined {
  return sessionPlanMap.get(sessionID)
}

export function clearSessionPlanName(sessionID: string): void {
  sessionPlanMap.delete(sessionID)
}

/** @internal For testing only */
export function _resetPlanTrackerForTesting(): void {
  sessionPlanMap.clear()
}
