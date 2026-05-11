const sessionCreatedTeamRunIds = new Set<string>()

export function registerTeamRunForSessionCleanup(teamRunId: string): void {
  sessionCreatedTeamRunIds.add(teamRunId)
}

export function unregisterTeamRunForSessionCleanup(teamRunId: string): void {
  sessionCreatedTeamRunIds.delete(teamRunId)
}

export function getSessionCreatedTeamRunIds(): string[] {
  return Array.from(sessionCreatedTeamRunIds)
}

export function clearSessionTeamRunCleanupRegistry(): void {
  sessionCreatedTeamRunIds.clear()
}
