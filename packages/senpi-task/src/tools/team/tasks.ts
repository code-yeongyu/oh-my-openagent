import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import type { Task } from "@oh-my-opencode/team-core/types"
import { Type } from "typebox"
import type { Static } from "typebox"

import {
  TeamTaskAlreadyClaimedError,
  TeamTaskBlockedByError,
  TeamTaskCrossOwnerUpdateError,
  TeamTaskInvalidTransitionError,
} from "../../team"
import { toolResult } from "../control"
import { isMissingStateError } from "./classify-error"
import type { TeamToolDeps, TeamToolsService } from "./types"

const TaskStatusSchema = Type.Union(
  [Type.Literal("pending"), Type.Literal("claimed"), Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("deleted")],
  { description: "Task status." },
)

export const TeamTaskCreateParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id." }),
  subject: Type.String({ description: "Short task subject." }),
  description: Type.String({ description: "Full task description." }),
  blocked_by: Type.Optional(Type.Array(Type.String(), { description: "Task ids that must complete first." })),
})

export const TeamTaskListParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id." }),
  status: Type.Optional(TaskStatusSchema),
  owner: Type.Optional(Type.String({ description: "Filter by owning member." })),
})

export const TeamTaskGetParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id (returned by team_create)." }),
  task_id: Type.String({ description: "Team tasklist task id (not a child st_... id)." }),
})

export const TeamTaskUpdateParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id (returned by team_create)." }),
  task_id: Type.String({ description: "Team tasklist task id (not a child st_... id)." }),
  status: TaskStatusSchema,
  owner: Type.Optional(Type.String({ description: "Owning member (defaults to the lead)." })),
})

export type TeamTaskCreateInput = Static<typeof TeamTaskCreateParams>
export type TeamTaskListInput = Static<typeof TeamTaskListParams>
export type TeamTaskGetInput = Static<typeof TeamTaskGetParams>
export type TeamTaskUpdateInput = Static<typeof TeamTaskUpdateParams>

export type TeamTaskCreateDetails = { readonly kind: "created"; readonly task: Task }
export type TeamTaskListDetails = { readonly kind: "list"; readonly tasks: readonly Task[] }
export type TeamTaskGetDetails = { readonly kind: "task"; readonly task: Task } | { readonly kind: "not_found"; readonly task_id: string }
export type TeamTaskUpdateDetails =
  | { readonly kind: "updated"; readonly task: Task }
  | { readonly kind: "already_claimed"; readonly task_id: string; readonly reason: string }
  | { readonly kind: "blocked_by"; readonly task_id: string; readonly reason: string }
  | { readonly kind: "invalid_transition"; readonly task_id: string; readonly reason: string }
  | { readonly kind: "cross_owner"; readonly task_id: string; readonly reason: string }

const ECHO_TEXT_MAX = 160
const ECHO_DESCRIPTION_MAX = 1_000

function collapseEcho(value: string, max = ECHO_TEXT_MAX): string {
  const collapsed = value.replace(/\s+/g, " ").trim()
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}...`
}

export async function runTeamTaskCreate(service: TeamToolsService, params: TeamTaskCreateInput): Promise<AgentToolResult<TeamTaskCreateDetails>> {
  const task = await service.createTask(params.team_run_id, {
    subject: params.subject,
    description: params.description,
    status: "pending",
    ...(params.blocked_by !== undefined ? { blockedBy: params.blocked_by } : {}),
  })
  const blockers = task.blockedBy.length > 0 ? `, blocked by: ${collapseEcho(task.blockedBy.join(", "))}` : ""
  return toolResult(`Created task ${task.id}: '${collapseEcho(task.subject)}' (status: ${task.status}${blockers}).`, { kind: "created", task })
}

export async function runTeamTaskList(service: TeamToolsService, params: TeamTaskListInput): Promise<AgentToolResult<TeamTaskListDetails>> {
  const filter = {
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.owner !== undefined ? { owner: params.owner } : {}),
  }
  const tasks = await service.listTasks(params.team_run_id, filter)
  const lines = tasks.map((task) => {
    const owner = task.owner === undefined ? "" : ` owner:${collapseEcho(task.owner)}`
    const blockers = task.blockedBy.length > 0 ? ` (blocked by: ${collapseEcho(task.blockedBy.join(", "))})` : ""
    return `- ${task.id} [${task.status}]${owner} '${collapseEcho(task.subject)}'${blockers}`
  })
  return toolResult([`${tasks.length} task(s).`, ...lines].join("\n"), { kind: "list", tasks })
}

export async function runTeamTaskGet(service: TeamToolsService, params: TeamTaskGetInput): Promise<AgentToolResult<TeamTaskGetDetails>> {
  try {
    const task = await service.getTask(params.team_run_id, params.task_id)
    const lines = [
      `Task ${task.id}: ${task.status}.`,
      `subject: ${collapseEcho(task.subject)}`,
      ...(task.owner === undefined ? [] : [`owner: ${collapseEcho(task.owner)}`]),
      `description: ${collapseEcho(task.description, ECHO_DESCRIPTION_MAX)}`,
      ...(task.blocks.length > 0 ? [`blocks: ${collapseEcho(task.blocks.join(", "))}`] : []),
      ...(task.blockedBy.length > 0 ? [`blocked by: ${collapseEcho(task.blockedBy.join(", "))}`] : []),
    ]
    return toolResult(lines.join("\n"), { kind: "task", task })
  } catch (error) {
    if (isMissingStateError(error)) return toolResult(`No task '${params.task_id}'.`, { kind: "not_found", task_id: params.task_id })
    throw error
  }
}

export async function runTeamTaskUpdate(service: TeamToolsService, params: TeamTaskUpdateInput): Promise<AgentToolResult<TeamTaskUpdateDetails>> {
  try {
    const task = await service.updateTask({
      teamRunId: params.team_run_id,
      taskId: params.task_id,
      status: params.status,
      ...(params.owner !== undefined ? { owner: params.owner } : {}),
    })
    const owner = task.owner === undefined ? "" : ` (owner: ${collapseEcho(task.owner)})`
    return toolResult(`Updated task ${task.id} to ${task.status}${owner}: '${collapseEcho(task.subject)}'.`, { kind: "updated", task })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (error instanceof TeamTaskAlreadyClaimedError) return toolResult(reason, { kind: "already_claimed", task_id: params.task_id, reason })
    if (error instanceof TeamTaskBlockedByError) return toolResult(reason, { kind: "blocked_by", task_id: params.task_id, reason })
    if (error instanceof TeamTaskInvalidTransitionError) return toolResult(reason, { kind: "invalid_transition", task_id: params.task_id, reason })
    if (error instanceof TeamTaskCrossOwnerUpdateError) return toolResult(reason, { kind: "cross_owner", task_id: params.task_id, reason })
    throw error
  }
}

// The four lead tasklist tools only matter once a team exists, so they ride the
// tool-search catalog (exposure "search") instead of the resident tool list:
// zero prompt tokens until a tasklist operation is actually searched for. Each
// description leads with the situation that selects the tool.
const TEAM_TASK_SEARCH_GROUP = "team-tasklist" as const

type TaskSearchMeta = Pick<ToolDefinition, "exposure" | "searchText" | "searchKeywords" | "searchGroup" | "allowLazyActivation">

function taskSearchMeta(searchText: string, searchKeywords: readonly string[]): TaskSearchMeta {
  return { exposure: "search", searchText, searchKeywords, searchGroup: TEAM_TASK_SEARCH_GROUP, allowLazyActivation: true }
}

export function createTeamTaskCreateTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "task_create",
    label: "Task Create",
    description: "Adds a pending entry to a running team's shared tasklist so members can claim it, for when the user wants to break work into claimable items without spawning an agent yet. Spawning child work itself goes through task.",
    parameters: TeamTaskCreateParams,
    execute: (_toolCallId: string, params: TeamTaskCreateInput) => runTeamTaskCreate(deps.service, params),
    ...taskSearchMeta("add a task to the team board, register a work item for the team to claim, break work into claimable team tasks", ["add team task", "claimable work item", "team tasklist entry"]),
  }
}

export function createTeamTaskListTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "task_list",
    label: "Task List",
    description: "Lists the entries on a running team's shared tasklist, optionally filtered by status or owner, for when the user wants to see what work items exist and who holds them. Child-agent run state is read through task_output, not here.",
    parameters: TeamTaskListParams,
    execute: (_toolCallId: string, params: TeamTaskListInput) => runTeamTaskList(deps.service, params),
    ...taskSearchMeta("see the team task board, what work items are pending or claimed, who owns which team task", ["team task list", "task board", "who owns a task", "pending team tasks"]),
  }
}

export function createTeamTaskGetTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "task_get",
    label: "Task Get",
    description: "Reads one entry from a running team's shared tasklist by its tasklist id, for when the user needs a single item's details or status. A child agent's output is read through task_output with its st_... id, not here.",
    parameters: TeamTaskGetParams,
    execute: (_toolCallId: string, params: TeamTaskGetInput) => runTeamTaskGet(deps.service, params),
    ...taskSearchMeta("read one team task, check a work item's status or description by id", ["read team task", "task details", "task by id"]),
  }
}

export function createTeamTaskUpdateTool(deps: TeamToolDeps): ToolDefinition {
  return {
    name: "task_update",
    label: "Task Update",
    description: "Moves one entry on a running team's shared tasklist between pending, claimed, in_progress, completed, and deleted, for when the user or a member marks work started, finished, or abandoned. The transition rules and claim owner are enforced by the service.",
    parameters: TeamTaskUpdateParams,
    execute: (_toolCallId: string, params: TeamTaskUpdateInput) => runTeamTaskUpdate(deps.service, params),
    ...taskSearchMeta("mark a team task done or in progress, claim or release a work item, change a task's status on the team board", ["mark task done", "claim task", "update task status", "task progress"]),
  }
}
