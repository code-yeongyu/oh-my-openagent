import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { lookupTeamSession, type TeamSessionEntry } from "../team-session-registry"
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import { getLeadMemberName } from "../team-runtime/shutdown-helpers"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"

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

function resolveRuntimeStateLoadFailure(error: unknown): undefined {
  if (error instanceof Error) return undefined
  return undefined
}

function resolveRegisteredParticipant(
  runtimeState: RuntimeState,
  registryEntry: TeamSessionEntry,
): TeamParticipant | undefined {
  const member = runtimeState.members.find((candidate) => candidate.name === registryEntry.memberName)
  if (!member) return undefined
  return registryEntry.role === "lead"
    ? { role: "lead", memberName: member.name }
    : { role: "member", memberName: member.name }
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
  const registryEntry = lookupTeamSession(sessionID)
  if (registryEntry) {
    const runtimeState = await deps.loadRuntimeState(registryEntry.teamRunId, config).catch(resolveRuntimeStateLoadFailure)
    if (runtimeState && ACTIVE_RUNTIME_STATUSES.has(runtimeState.status) && resolveRegisteredParticipant(runtimeState, registryEntry)) {
      return runtimeState
    }
  }

  for (const activeTeam of await deps.listActiveTeams(config)) {
    const runtimeState = await deps.loadRuntimeState(activeTeam.teamRunId, config).catch(resolveRuntimeStateLoadFailure)
    if (!runtimeState || !ACTIVE_RUNTIME_STATUSES.has(runtimeState.status)) continue
    if (runtimeState.leadSessionId === sessionID) return runtimeState
    if (runtimeState.members.some((member) => member.sessionId === sessionID)) return runtimeState
  }
}

export async function resolveParticipant(teamRunId: string, sessionID: string, config: TeamModeConfig, deps: TeamRuntimeStoreDeps): Promise<{ runtimeState: RuntimeState; participant?: TeamParticipant }> {
  const registryEntry = lookupTeamSession(sessionID)
  const runtimeState = await deps.loadRuntimeState(teamRunId, config)
  if (registryEntry?.teamRunId === teamRunId) {
    const participant = resolveRegisteredParticipant(runtimeState, registryEntry)
    if (participant) return { runtimeState, participant }
  }

  if (runtimeState.leadSessionId === sessionID) {
    return { runtimeState, participant: { role: "lead", memberName: getLeadMemberName(runtimeState) } }
  }
  const member = runtimeState.members.find((candidate) => candidate.sessionId === sessionID)
  return member ? { runtimeState, participant: { role: "member", memberName: member.name } } : { runtimeState }
}
