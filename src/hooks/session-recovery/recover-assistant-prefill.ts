const RECOVERY_COOLDOWN_MS = 60_000
const recoveryTimestamps = new Map<string, number>()

export function canAttemptPrefillRecovery(sessionID: string): boolean {
  const lastAttempt = recoveryTimestamps.get(sessionID)
  if (!lastAttempt) return true
  return Date.now() - lastAttempt > RECOVERY_COOLDOWN_MS
}

export function markPrefillRecoveryAttempted(sessionID: string): void {
  recoveryTimestamps.set(sessionID, Date.now())
}

export function clearPrefillRecoveryState(sessionID: string): void {
  recoveryTimestamps.delete(sessionID)
}
