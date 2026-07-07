import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import { toolResult } from "../control"
import { isMissingStateError } from "./classify-error"
import type { ActiveTeamSummary, TeamToolDeps, TeamToolsService } from "./types"

export const TeamStatusParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id to inspect." }),
})

export const TeamListParams = Type.Object({})

export type TeamStatusInput = Static<typeof TeamStatusParams>

export type TeamStatusMemberView = { readonly name: string; readonly status: string; readonly session_id?: string }

export type TeamStatusDetails =
  | { readonly kind: "status"; readonly team_run_id: string; readonly team_name: string; readonly status: string; readonly members: readonly TeamStatusMemberView[] }
  | { readonly kind: "not_found"; readonly team_run_id: string }

export type TeamListRow = {
  readonly team_run_id: string
  readonly team_name: string
  readonly status: string
  readonly member_count: number
  readonly scope: "project" | "user"
}

export type TeamListDetails = { readonly kind: "list"; readonly teams: readonly TeamListRow[] }

export async function runTeamStatus(service: TeamToolsService, params: TeamStatusInput): Promise<AgentToolResult<TeamStatusDetails>> {
  try {
    const state = await service.status(params.team_run_id)
    const members = state.members.map((member) => ({
      name: member.name,
      status: member.status,
      ...(member.sessionId !== undefined ? { session_id: member.sessionId } : {}),
    }))
    return toolResult(
      `Team '${state.teamName}' is ${state.status} with ${members.length} members.`,
      { kind: "status", team_run_id: state.teamRunId, team_name: state.teamName, status: state.status, members },
    )
  } catch (error) {
    if (isMissingStateError(error)) return toolResult(`No team run '${params.team_run_id}'.`, { kind: "not_found", team_run_id: params.team_run_id })
    throw error
  }
}

function toRow(summary: ActiveTeamSummary): TeamListRow {
  return {
    team_run_id: summary.teamRunId,
    team_name: summary.teamName,
    status: summary.status,
    member_count: summary.memberCount,
    scope: summary.scope,
  }
}

export async function runTeamList(service: TeamToolsService): Promise<AgentToolResult<TeamListDetails>> {
  const teams = (await service.listTeams()).map(toRow)
  return toolResult(`${teams.length} active team run(s).`, { kind: "list", teams })
}

export function createTeamStatusTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "team_status",
    label: "Team Status",
    description: "Return the current status and members of a team run.",
    parameters: TeamStatusParams,
    execute: (_toolCallId: string, params: TeamStatusInput) => runTeamStatus(deps.service, params),
  }
}

export function createTeamListTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "team_list",
    label: "Team List",
    description: "List the active team runs.",
    parameters: TeamListParams,
    execute: () => runTeamList(deps.service),
  }
}
