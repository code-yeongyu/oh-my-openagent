const seenSessionIDs = new Set<string>()

export function shouldInvalidateSkillCacheForSession(sessionID?: string): boolean {
  if (!sessionID || seenSessionIDs.has(sessionID)) {
    return false
  }

  seenSessionIDs.add(sessionID)
  return true
}
