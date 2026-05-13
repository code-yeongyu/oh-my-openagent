import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import type { TeamModeConfig } from "../../config/schema/team-mode"
import {
  lookupTeamSession,
  registerTeamSession,
  unregisterTeamSession,
} from "../../features/team-mode/team-session-registry"
import type { RuntimeState } from "../../features/team-mode/types"
import {
  listActiveTeams,
  loadRuntimeState,
} from "../../features/team-mode/team-state-store"
import { log } from "../../shared/logger"

const ACTIVE_RUNTIME_STATUSES = new Set<RuntimeState["status"]>([
  "creating",
  "active",
  "shutdown_requested",
  "orphaned",
  "deleting",
])
const UNIVERSAL_TOOL_NAMES = new Set([
  "team_send_message",
  "team_task_create",
  "team_task_list",
  "team_task_update",
  "team_task_get",
  "team_status",
])

type TeamParticipant =
  | { role: "neither" }
  | { role: "lead"; teamRunId: string }
  | { role: "member"; teamRunId: string; memberName: string }

function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === "string" ? value : undefined
}

type RegistryParticipant = Exclude<TeamParticipant, { role: "neither" }>

function resolveParticipantFromRegistry(sessionID: string): RegistryParticipant | undefined {
  const entry = lookupTeamSession(sessionID)
  if (!entry) return undefined
  if (entry.role === "lead") {
    return { role: "lead", teamRunId: entry.teamRunId }
  }
  return { role: "member", teamRunId: entry.teamRunId, memberName: entry.memberName }
}

async function isRuntimeStateMissing(teamRunId: string, config: TeamModeConfig): Promise<boolean> {
  try {
    await loadRuntimeState(teamRunId, config)
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // Treat missing state.json or a missing runtime dir as "stale registry";
    // any other read/parse error is preserved (raised by the next caller)
    // because it is not safe to silently treat malformed state as deleted.
    return code === "ENOENT" || code === "ENOTDIR"
  }
}

async function resolveParticipant(sessionID: string, config: TeamModeConfig): Promise<TeamParticipant> {
  const fromRegistry = resolveParticipantFromRegistry(sessionID)
  if (fromRegistry) {
    if (await isRuntimeStateMissing(fromRegistry.teamRunId, config)) {
      log("[team-tool-gating] discarding stale registry entry: state.json missing", {
        sessionID,
        teamRunId: fromRegistry.teamRunId,
      })
      unregisterTeamSession(sessionID)
    } else {
      return fromRegistry
    }
  }

  const activeTeams = await listActiveTeams(config)

  for (const activeTeam of activeTeams) {
    const runtimeState = await loadRuntimeState(activeTeam.teamRunId, config)
    if (!ACTIVE_RUNTIME_STATUSES.has(runtimeState.status)) {
      continue
    }

    if (runtimeState.leadSessionId === sessionID) {
      const leadMemberName = runtimeState.members.find((member) => member.agentType === "leader")?.name ?? "lead"
      const registeredEntry = registerTeamSession(sessionID, {
        teamRunId: runtimeState.teamRunId,
        memberName: leadMemberName,
        role: "lead",
      }, { overwrite: false })
      if (registeredEntry.role === "lead") {
        return { role: "lead", teamRunId: registeredEntry.teamRunId }
      }

      return {
        role: "member",
        teamRunId: registeredEntry.teamRunId,
        memberName: registeredEntry.memberName,
      }
    }

    const matchedMember = runtimeState.members.find((member) => member.sessionId === sessionID)
    if (matchedMember) {
      const registeredEntry = registerTeamSession(sessionID, {
        teamRunId: runtimeState.teamRunId,
        memberName: matchedMember.name,
        role: "member",
      }, { overwrite: false })
      if (registeredEntry.role === "lead") {
        return { role: "lead", teamRunId: registeredEntry.teamRunId }
      }

      return {
        role: "member",
        teamRunId: registeredEntry.teamRunId,
        memberName: registeredEntry.memberName,
      }
    }
  }

  return { role: "neither" }
}

function isLeadOfTargetTeam(participant: TeamParticipant, teamRunId: string | undefined): boolean {
  return participant.role === "lead" && participant.teamRunId === teamRunId
}

function isTargetMember(participant: TeamParticipant, teamRunId: string | undefined, memberName: string | undefined): boolean {
  return participant.role === "member"
    && participant.teamRunId === teamRunId
    && participant.memberName === memberName
}

export function createTeamToolGating(_ctx: PluginInput, config: TeamModeConfig | undefined): Hooks {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      if (!config?.enabled) {
        return
      }

      const toolName = input.tool
      if (!toolName.startsWith("team_") && toolName !== "delegate-task") {
        return
      }

      const participant = await resolveParticipant(input.sessionID, config)

      if (toolName === "delegate-task") {
        return
      }

      if (toolName === "team_create") {
        if (participant.role !== "neither") {
          throw new Error(`team_create denied: session is already a participant of team ${participant.teamRunId}`)
        }

        return
      }

      const teamRunId = getStringArg(output.args, "teamRunId")
      const memberName = getStringArg(output.args, "memberName")

      if (toolName === "team_delete" || toolName === "team_shutdown_request") {
        if (!isLeadOfTargetTeam(participant, teamRunId)) {
          throw new Error(`${toolName} is lead-only`)
        }

        return
      }

      if (toolName === "team_approve_shutdown" || toolName === "team_reject_shutdown") {
        if (!isLeadOfTargetTeam(participant, teamRunId) && !isTargetMember(participant, teamRunId, memberName)) {
          throw new Error(`${toolName}: caller must be target member or team lead`)
        }

        return
      }

      if (toolName === "team_list") {
        return
      }

      if (UNIVERSAL_TOOL_NAMES.has(toolName)) {
        if (
          (participant.role === "lead" || participant.role === "member")
          && participant.teamRunId === teamRunId
        ) {
          return
        }

        throw new Error(
          teamRunId === undefined
            ? `team-mode tool ${toolName} requires teamRunId argument`
            : `team-mode tool ${toolName} denied: not a participant of team ${teamRunId}`,
        )
      }
    },
  }
}
