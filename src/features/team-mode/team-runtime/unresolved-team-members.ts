import type { RuntimeStateMember } from "../types"

export function hasUnresolvedTeamMembers(members: readonly RuntimeStateMember[]): boolean {
  return members.some((member) => member.sessionId === undefined)
}

export function assertNoUnresolvedTeamMembers(members: readonly RuntimeStateMember[]): void {
  const unresolved = members.filter((member) => member.sessionId === undefined)
  if (unresolved.length === 0) return

  const summary = unresolved
    .map((member) => `${member.name} (${member.status})`)
    .join(", ")
  throw new Error(`team runtime cannot transition to active with unresolved member(s): ${summary}`)
}
