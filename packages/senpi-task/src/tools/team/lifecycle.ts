import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import { SenpiTeamRuntimeError, SenpiTeamSpecError } from "../../team"
import type { CreatedMemberInfo } from "../../team"
import type { ResolvedModelRecord } from "../../state"
import { toolResult } from "../control"
import { qualifyResolvedModelDisplay } from "../task/resolved-model-display"
import type { TeamToolDeps, TeamToolsService } from "./types"

export const TeamCreateParams = Type.Object({
  team_name: Type.Optional(
    Type.String({ description: "Named team spec (project .omo/teams or omo.json) to create. Provide exactly one of team_name or inline_spec." }),
  ),
  inline_spec: Type.Optional(
    Type.Unknown({ description: "Inline team spec object, e.g. { name, members: [{ name, category|subagent_type, prompt? }] }. Provide exactly one of team_name or inline_spec." }),
  ),
})

export const TeamDeleteParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id to delete." }),
  force: Type.Optional(Type.Boolean({ description: "Tear the run down even while members are still active." })),
})

export type TeamCreateInput = Static<typeof TeamCreateParams>
export type TeamDeleteInput = Static<typeof TeamDeleteParams>

export type TeamCreateMemberView = {
  readonly name: string
  readonly status: string
  readonly role: string
  readonly task_id: string
  readonly model?: ResolvedModelRecord
  readonly prompt_excerpt?: string
}

export type TeamCreateDetails =
  | { readonly kind: "created"; readonly team_run_id: string; readonly team_name: string; readonly members: readonly TeamCreateMemberView[] }
  | { readonly kind: "invalid_arguments"; readonly reason: string }
  | { readonly kind: "spec_error"; readonly code: string; readonly reason: string }
  | { readonly kind: "runtime_error"; readonly code: string; readonly reason: string }

export type TeamDeleteDetails =
  | { readonly kind: "deleted"; readonly team_run_id: string; readonly cancelled_task_ids: readonly string[] }
  | { readonly kind: "invalid_state"; readonly team_run_id: string; readonly code: string; readonly reason: string }

const CREATE_DESCRIPTION = [
  "Create a team run from a named spec or an inline spec. The current session is the team lead.",
  "Provide exactly one of team_name or inline_spec. Members run as background children; you coordinate them with the other team_* tools.",
].join(" ")

const DELETE_DESCRIPTION = "Delete a team run and cancel its members. Lead-only. Pass force=true to tear it down while members are still active."

export async function runTeamCreate(service: TeamToolsService, params: TeamCreateInput): Promise<AgentToolResult<TeamCreateDetails>> {
  const hasName = params.team_name !== undefined && params.team_name.length > 0
  const hasInline = params.inline_spec !== undefined
  if (hasName === hasInline) {
    return toolResult("Provide exactly one of team_name or inline_spec.", { kind: "invalid_arguments", reason: "provide exactly one of team_name or inline_spec" })
  }

  try {
    const result = await service.createTeam(
      hasName ? { teamName: params.team_name } : { inlineSpec: params.inline_spec },
    )
    const state = result.runtimeState
    const members: TeamCreateMemberView[] = result.members.map((member) => ({
      name: member.name,
      status: member.status,
      role: formatMemberRole(member.role),
      task_id: member.taskId,
      ...(member.model !== undefined ? { model: member.model } : {}),
      ...(member.promptExcerpt !== undefined ? { prompt_excerpt: member.promptExcerpt } : {}),
    }))
    const lines = [
      `Created team '${state.teamName}' (${state.teamRunId}) with ${members.length} members.`,
      ...result.members.map((member) => formatCreatedMemberLine(member)),
    ]
    return toolResult(
      lines.join("\n"),
      { kind: "created", team_run_id: state.teamRunId, team_name: state.teamName, members },
    )
  } catch (error) {
    if (error instanceof SenpiTeamSpecError) return toolResult(error.message, { kind: "spec_error", code: error.code, reason: error.message })
    if (error instanceof SenpiTeamRuntimeError) return toolResult(error.message, { kind: "runtime_error", code: error.code, reason: error.message })
    throw error
  }
}

export async function runTeamDelete(service: TeamToolsService, params: TeamDeleteInput): Promise<AgentToolResult<TeamDeleteDetails>> {
  try {
    const result = await service.deleteTeam({ teamRunId: params.team_run_id, force: params.force })
    const cancelled = result.cancelledTaskIds
    const suffix = cancelled.length === 0 ? "" : `: ${cancelled.join(", ")}`
    return toolResult(
      `Deleted team ${result.teamRunId}; cancelled ${cancelled.length} member task(s)${suffix}.`,
      { kind: "deleted", team_run_id: result.teamRunId, cancelled_task_ids: result.cancelledTaskIds },
    )
  } catch (error) {
    if (error instanceof SenpiTeamRuntimeError) {
      return toolResult(error.message, { kind: "invalid_state", team_run_id: params.team_run_id, code: error.code, reason: error.message })
    }
    throw error
  }
}

function formatMemberRole(role: CreatedMemberInfo["role"]): string {
  return role.kind === "category" ? `category:${role.category}` : `subagent_type:${role.subagentType}`
}

// Prompt excerpts stay in details, never in the text lines: echoing raw member prompts into the
// lead conversation lets their content spoof scanners that match markers in the message stream
// (e2e role detection, keyword triggers).
function formatCreatedMemberLine(member: CreatedMemberInfo): string {
  return `- ${member.name} [${member.status}] ${formatMemberRole(member.role)}${formatModelSegment(member.model)} task:${member.taskId}`
}

function formatModelSegment(model: ResolvedModelRecord | undefined): string {
  if (model === undefined) return ""
  const display = qualifyResolvedModelDisplay(model.provider, model.display) ?? model.model_id
  const reasoning = model.reasoning_effort === undefined ? "" : ` reasoning:${model.reasoning_effort}`
  const variant = model.variant === undefined ? "" : ` variant:${model.variant}`
  return ` (${display}${reasoning}${variant})`
}

export function createTeamCreateTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "team_create",
    label: "Team Create",
    description: CREATE_DESCRIPTION,
    parameters: TeamCreateParams,
    execute: (_toolCallId: string, params: TeamCreateInput) => runTeamCreate(deps.service, params),
  }
}

export function createTeamDeleteTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "team_delete",
    label: "Team Delete",
    description: DELETE_DESCRIPTION,
    parameters: TeamDeleteParams,
    execute: (_toolCallId: string, params: TeamDeleteInput) => runTeamDelete(deps.service, params),
  }
}
