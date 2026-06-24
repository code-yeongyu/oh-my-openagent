import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { lookupTeamSession } from "../team-session-registry"
import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import type { Message, RuntimeState } from "@oh-my-opencode/team-core/types"

export type TeamRuntimeDetails = {
  teamRunId: string
  isLead: boolean
  senderName: string
  activeMembers: string[]
}

export type TeamSendMessageToolDeps = {
  loadRuntimeState: typeof loadRuntimeState
}

export const defaultTeamSendMessageToolDeps: TeamSendMessageToolDeps = {
  loadRuntimeState,
}

type RuntimeMember = RuntimeState["members"][number]

export function shouldReserveRecipientMailbox(member: RuntimeMember, message: Message, senderName: string): boolean {
  if (message.to === "*") {
    return member.name !== senderName
  }

  return member.name === message.to
}

export async function resolveTeamRuntimeDetails(
  teamRunId: string,
  sessionID: string,
  config: TeamModeConfig,
  deps: TeamSendMessageToolDeps,
): Promise<TeamRuntimeDetails> {
  const registryEntry = lookupTeamSession(sessionID)
  if (registryEntry?.teamRunId === teamRunId) {
    const runtimeState = await deps.loadRuntimeState(teamRunId, config)

    return {
      teamRunId: runtimeState.teamRunId,
      isLead: registryEntry.role === "lead",
      senderName: registryEntry.memberName,
      activeMembers: runtimeState.members
        .map((entry) => entry.name)
        .filter((name) => name !== registryEntry.memberName),
    }
  }

  try {
    const runtimeState = await deps.loadRuntimeState(teamRunId, config)
    const isLead = runtimeState.leadSessionId === sessionID
    const leadMember = isLead
      ? runtimeState.members.find((member) => member.agentType === "leader")
      : undefined
    const member = runtimeState.members.find((entry) => entry.sessionId === sessionID)
    const senderName = leadMember?.name ?? member?.name ?? "unknown"

    return {
      teamRunId: runtimeState.teamRunId,
      isLead,
      senderName,
      activeMembers: runtimeState.members
        .map((entry) => entry.name)
        .filter((name) => name !== senderName),
    }
  } catch (error) {
    error instanceof Error
    return {
      teamRunId,
      isLead: false,
      senderName: "unknown",
      activeMembers: [],
    }
  }
}
