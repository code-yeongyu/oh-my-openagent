export type TeamSessionRole = "lead" | "member"

export type TeamSessionEntry = {
  teamRunId: string
  memberName: string
  role: TeamSessionRole
}

const registry = new Map<string, TeamSessionEntry>()

export function registerTeamSession(sessionId: string, entry: TeamSessionEntry): void {
  registry.set(sessionId, entry)
}

export function lookupTeamSession(sessionId: string): TeamSessionEntry | undefined {
  return registry.get(sessionId)
}

export function unregisterTeamSession(sessionId: string): void {
  registry.delete(sessionId)
}

export function unregisterTeamSessionsByTeam(teamRunId: string): void {
  for (const [sessionId, entry] of registry.entries()) {
    if (entry.teamRunId === teamRunId) {
      registry.delete(sessionId)
    }
  }
}

export function clearTeamSessionRegistry(): void {
  registry.clear()
}
