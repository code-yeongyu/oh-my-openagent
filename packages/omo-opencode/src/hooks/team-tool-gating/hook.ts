import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import type { TeamModeConfig } from "../../config/schema/team-mode"
import { lookupTeamSession } from "../../features/team-mode/team-session-registry"
import type { RuntimeState } from "../../features/team-mode/types"
import {
  listActiveTeams,
  loadRuntimeState,
} from "../../features/team-mode/team-state-store"
import { detectDestructiveBashCommand, isEditPathAllowed } from "./inline-file-guard"

const ACTIVE_RUNTIME_STATUSES = new Set<RuntimeState["status"]>(["creating", "active", "shutdown_requested"])
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

function resolveParticipantFromRegistry(sessionID: string): TeamParticipant | undefined {
  const entry = lookupTeamSession(sessionID)
  if (!entry) return undefined
  if (entry.role === "lead") {
    return { role: "lead", teamRunId: entry.teamRunId }
  }
  return { role: "member", teamRunId: entry.teamRunId, memberName: entry.memberName }
}

async function resolveParticipant(sessionID: string, config: TeamModeConfig): Promise<TeamParticipant> {
  const fromRegistry = resolveParticipantFromRegistry(sessionID)
  if (fromRegistry) {
    return fromRegistry
  }

  const activeTeams = await listActiveTeams(config)

  for (const activeTeam of activeTeams) {
    const runtimeState = await loadRuntimeState(activeTeam.teamRunId, config)
    if (!ACTIVE_RUNTIME_STATUSES.has(runtimeState.status)) {
      continue
    }

    if (runtimeState.leadSessionId === sessionID) {
      return { role: "lead", teamRunId: runtimeState.teamRunId }
    }

    const matchedMember = runtimeState.members.find((member) => member.sessionId === sessionID)
    if (matchedMember) {
      return {
        role: "member",
        teamRunId: runtimeState.teamRunId,
        memberName: matchedMember.name,
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

export function createTeamToolGating(ctx: PluginInput, config: TeamModeConfig | undefined): Hooks {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      if (!config?.enabled) {
        return
      }

      const toolName = input.tool

      if (toolName === "edit") {
        await enforceEditAllowedPaths(input.sessionID, output.args, ctx, config)
        return
      }

      if (toolName === "bash") {
        await enforceBashGuardrail(input.sessionID, output.args, ctx, config)
        return
      }

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

type MemberFileBoundary = {
  worktreePath?: string
  allowedPaths?: string[]
}

async function resolveMemberFileBoundary(
  teamRunId: string,
  memberName: string,
  config: TeamModeConfig,
): Promise<MemberFileBoundary | undefined> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  if (!ACTIVE_RUNTIME_STATUSES.has(runtimeState.status)) return undefined
  const member = runtimeState.members.find((entry) => entry.name === memberName)
  if (!member) return undefined
  return { worktreePath: member.worktreePath, allowedPaths: member.allowedPaths }
}

async function enforceEditAllowedPaths(
  sessionID: string,
  args: Record<string, unknown>,
  ctx: PluginInput,
  config: TeamModeConfig,
): Promise<void> {
  const participant = await resolveParticipant(sessionID, config)
  if (participant.role !== "member") return

  const boundary = await resolveMemberFileBoundary(participant.teamRunId, participant.memberName, config)
  if (!boundary) return
  if (boundary.worktreePath) return
  if (!boundary.allowedPaths || boundary.allowedPaths.length === 0) return

  const filePath = getStringArg(args, "filePath")
  if (!filePath) {
    throw new Error(`edit denied: member ${participant.memberName} has allowedPaths set but no filePath was provided`)
  }
  if (!isEditPathAllowed(boundary.allowedPaths, filePath, ctx.directory)) {
    throw new Error(
      `edit denied: "${filePath}" is outside member ${participant.memberName}'s allowedPaths [${boundary.allowedPaths.join(", ")}]`,
    )
  }
}

async function enforceBashGuardrail(
  sessionID: string,
  args: Record<string, unknown>,
  ctx: PluginInput,
  config: TeamModeConfig,
): Promise<void> {
  const participant = await resolveParticipant(sessionID, config)
  if (participant.role !== "member") return

  const boundary = await resolveMemberFileBoundary(participant.teamRunId, participant.memberName, config)
  if (!boundary) return
  if (boundary.worktreePath) return
  if (!boundary.allowedPaths || boundary.allowedPaths.length === 0) return

  const command = getStringArg(args, "command")
  if (!command) return

  const matchedPattern = detectDestructiveBashCommand(command)
  if (matchedPattern !== null) {
    throw new Error(
      `bash denied: command matches destructive pattern "${matchedPattern}". Member ${participant.memberName} is in inline mode with allowedPaths set; destructive git/rm commands that could destroy other members' work are blocked. If you genuinely need this, ask the lead or use a worktree member.`,
    )
  }
}
