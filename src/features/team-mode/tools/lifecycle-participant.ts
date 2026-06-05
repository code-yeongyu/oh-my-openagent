import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { listActiveTeams, loadRuntimeState } from "../team-state-store/store"
import type { RuntimeState } from "../types"

const ACTIVE_RUNTIME_STATUSES = new Set<RuntimeState["status"]>(["creating", "active", "shutdown_requested"])

export type TeamLifecycleToolContext = {
  sessionID: string
  directory?: string
  agent?: string
  messageID?: string
}

export type TeamParticipant = { role: "lead" | "member"; memberName: string }

export type TeamRuntimeStoreDeps = {
  listActiveTeams: typeof listActiveTeams
  loadRuntimeState: typeof loadRuntimeState
}

export function getLeadMemberName(runtimeState: RuntimeState): string {
  const leadMember = runtimeState.members.find((member) => member.agentType === "leader")
  if (!leadMember) throw new Error(`team '${runtimeState.teamRunId}' is missing a lead member`)
  return leadMember.name
}

export function sanitizeRuntimeState(runtimeState: RuntimeState): Omit<RuntimeState, "members"> & {
  members: Array<Omit<RuntimeState["members"][number], "lastInjectedTurnMarker" | "pendingInjectedMessageIds">>
} {
  return {
    ...runtimeState,
    members: runtimeState.members.map(({ lastInjectedTurnMarker: _turnMarker, pendingInjectedMessageIds: _pendingIds, ...member }) => member),
  }
}

export async function findParticipantRuntime(sessionID: string, config: TeamModeConfig, deps: TeamRuntimeStoreDeps): Promise<RuntimeState | undefined> {
  for (const activeTeam of await deps.listActiveTeams(config)) {
    const runtimeState = await deps.loadRuntimeState(activeTeam.teamRunId, config).catch(() => undefined)
    if (!runtimeState || !ACTIVE_RUNTIME_STATUSES.has(runtimeState.status)) continue
    if (runtimeState.leadSessionId === sessionID) return runtimeState
    if (runtimeState.members.some((member) => member.sessionId === sessionID)) return runtimeState
  }
}

export async function resolveParticipant(teamRunId: string, sessionID: string, config: TeamModeConfig, deps: TeamRuntimeStoreDeps): Promise<{ runtimeState: RuntimeState; participant?: TeamParticipant }> {
  const runtimeState = await deps.loadRuntimeState(teamRunId, config)
  if (runtimeState.leadSessionId === sessionID) {
    return { runtimeState, participant: { role: "lead", memberName: getLeadMemberName(runtimeState) } }
  }
  const member = runtimeState.members.find((candidate) => candidate.sessionId === sessionID)
  return member ? { runtimeState, participant: { role: "member", memberName: member.name } } : { runtimeState }
}
