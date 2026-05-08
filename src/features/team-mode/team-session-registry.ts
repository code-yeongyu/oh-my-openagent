export type TeamSessionRole = "lead" | "member"

export type TeamSessionEntry = {
  teamRunId: string
  memberName: string
  role: TeamSessionRole
}

type RegisterTeamSessionOptions = {
  overwrite?: boolean
}

const registry = new Map<string, TeamSessionEntry>()

function entriesMatch(left: TeamSessionEntry, right: TeamSessionEntry): boolean {
  return left.teamRunId === right.teamRunId
    && left.memberName === right.memberName
    && left.role === right.role
}

export function registerTeamSession(
  sessionId: string,
  entry: TeamSessionEntry,
  options?: RegisterTeamSessionOptions,
): TeamSessionEntry {
  const existingEntry = registry.get(sessionId)
  if (existingEntry) {
    if (entriesMatch(existingEntry, entry) || options?.overwrite === false) {
      return existingEntry
    }
  }

  registry.set(sessionId, entry)
  return entry
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
