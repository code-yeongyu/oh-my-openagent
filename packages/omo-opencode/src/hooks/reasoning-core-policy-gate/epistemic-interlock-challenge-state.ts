export interface ChallengeRecord {
  challengedAt: number
  reason: string
  kbEntriesCount: number
}

const challengeState = new Map<string, Map<string, ChallengeRecord>>()

export function recordChallenge(sessionID: string, filePath: string, reason: string, kbEntriesCount: number): void {
  const sessionChallenges = challengeState.get(sessionID) ?? new Map<string, ChallengeRecord>()
  sessionChallenges.set(filePath, {
    challengedAt: Date.now(),
    reason,
    kbEntriesCount,
  })
  challengeState.set(sessionID, sessionChallenges)
}

export function getChallenge(sessionID: string, filePath: string): ChallengeRecord | undefined {
  return challengeState.get(sessionID)?.get(filePath)
}

export function clearChallenge(sessionID: string, filePath: string): void {
  const sessionChallenges = challengeState.get(sessionID)
  if (!sessionChallenges) return

  sessionChallenges.delete(filePath)
  if (sessionChallenges.size === 0) {
    challengeState.delete(sessionID)
  }
}

export function clearChallengeState(sessionID: string): void {
  challengeState.delete(sessionID)
}
