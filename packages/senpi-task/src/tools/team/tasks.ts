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
  team_run_id: Type.String({ description: "Team run id." }),
  task_id: Type.String({ description: "Task id." }),
})

export const TeamTaskUpdateParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id." }),
  task_id: Type.String({ description: "Task id." }),
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

export async function runTeamTaskCreate(service: TeamToolsService, params: TeamTaskCreateInput): Promise<AgentToolResult<TeamTaskCreateDetails>> {
  const task = await service.createTask(params.team_run_id, {
    subject: params.subject,
    description: params.description,
    status: "pending",
    ...(params.blocked_by !== undefined ? { blockedBy: params.blocked_by } : {}),
  })
  const blockers = task.blockedBy.length > 0 ? `, blocked by: ${task.blockedBy.join(", ")}` : ""
  return toolResult(`Created task ${task.id}: '${task.subject}' (status: ${task.status}${blockers}).`, { kind: "created", task })
}

export async function runTeamTaskList(service: TeamToolsService, params: TeamTaskListInput): Promise<AgentToolResult<TeamTaskListDetails>> {
  const filter = {
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.owner !== undefined ? { owner: params.owner } : {}),
  }
  const tasks = await service.listTasks(params.team_run_id, filter)
  const lines = tasks.map((task) => {
    const owner = task.owner === undefined ? "" : ` owner:${task.owner}`
    const blockers = task.blockedBy.length > 0 ? ` (blocked by: ${task.blockedBy.join(", ")})` : ""
    return `- ${task.id} [${task.status}]${owner} '${task.subject}'${blockers}`
  })
  return toolResult([`${tasks.length} task(s).`, ...lines].join("\n"), { kind: "list", tasks })
}

export async function runTeamTaskGet(service: TeamToolsService, params: TeamTaskGetInput): Promise<AgentToolResult<TeamTaskGetDetails>> {
  try {
    const task = await service.getTask(params.team_run_id, params.task_id)
    const lines = [
      `Task ${task.id}: ${task.status}.`,
      `subject: ${task.subject}`,
      ...(task.owner === undefined ? [] : [`owner: ${task.owner}`]),
      `description: ${task.description}`,
      ...(task.blocks.length > 0 ? [`blocks: ${task.blocks.join(", ")}`] : []),
      ...(task.blockedBy.length > 0 ? [`blocked by: ${task.blockedBy.join(", ")}`] : []),
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
    const owner = task.owner === undefined ? "" : ` (owner: ${task.owner})`
    return toolResult(`Updated task ${task.id} to ${task.status}${owner}: '${task.subject}'.`, { kind: "updated", task })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (error instanceof TeamTaskAlreadyClaimedError) return toolResult(reason, { kind: "already_claimed", task_id: params.task_id, reason })
    if (error instanceof TeamTaskBlockedByError) return toolResult(reason, { kind: "blocked_by", task_id: params.task_id, reason })
    if (error instanceof TeamTaskInvalidTransitionError) return toolResult(reason, { kind: "invalid_transition", task_id: params.task_id, reason })
    if (error instanceof TeamTaskCrossOwnerUpdateError) return toolResult(reason, { kind: "cross_owner", task_id: params.task_id, reason })
    throw error
  }
}

export function createTeamTaskCreateTool(deps: TeamToolDeps): ToolDefinition {
  return { name: "task_create", label: "Task Create", description: "Create a task on the team tasklist.", parameters: TeamTaskCreateParams, execute: (_toolCallId: string, params: TeamTaskCreateInput) => runTeamTaskCreate(deps.service, params) }
}

export function createTeamTaskListTool(deps: TeamToolDeps): ToolDefinition {
  return { name: "task_list", label: "Task List", description: "List the team tasklist, optionally filtered by status or owner.", parameters: TeamTaskListParams, execute: (_toolCallId: string, params: TeamTaskListInput) => runTeamTaskList(deps.service, params) }
}

export function createTeamTaskGetTool(deps: TeamToolDeps): ToolDefinition {
  return { name: "task_get", label: "Task Get", description: "Read a single team task by id.", parameters: TeamTaskGetParams, execute: (_toolCallId: string, params: TeamTaskGetInput) => runTeamTaskGet(deps.service, params) }
}

export function createTeamTaskUpdateTool(deps: TeamToolDeps): ToolDefinition {
  return { name: "task_update", label: "Task Update", description: "Update a team task's status (status='claimed' claims it for the owner).", parameters: TeamTaskUpdateParams, execute: (_toolCallId: string, params: TeamTaskUpdateInput) => runTeamTaskUpdate(deps.service, params) }
}
