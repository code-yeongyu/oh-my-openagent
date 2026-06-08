import { tool, type ToolDefinition, type ToolContext } from "@opencode-ai/plugin/tool"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import { loadRuntimeState } from "../team-state-store"
import { createTask, getTask, listTasks, updateTaskStatus, claimTask } from "../team-tasklist"
import type { RuntimeState, Task } from "../types"

type TeamTaskToolContext = ToolContext & {
  sessionID?: string
}

type TeamTaskListFilter = {
  status?: "pending" | "claimed" | "in_progress" | "completed" | "deleted"
  owner?: string
}

type TeamTaskCreateArgs = {
  teamRunId: string
  subject: string
  description: string
  blockedBy?: string[]
}

type TeamTaskListArgs = {
  teamRunId: string
  status?: TeamTaskListFilter["status"]
  owner?: string
}

type TeamTaskUpdateArgs = {
  teamRunId: string
  taskId: string
  status: "pending" | "claimed" | "in_progress" | "completed" | "deleted"
}

type TeamTaskGetArgs = {
  teamRunId: string
  taskId: string
}

type TeamTaskToolDeps = {
  loadRuntimeState: typeof loadRuntimeState
  createTask: typeof createTask
  listTasks: typeof listTasks
  claimTask: typeof claimTask
  updateTaskStatus: typeof updateTaskStatus
  getTask: typeof getTask
}

const defaultDeps: TeamTaskToolDeps = {
  loadRuntimeState,
  createTask,
  listTasks,
  claimTask,
  updateTaskStatus,
  getTask,
}

async function resolveSenderName(teamRunId: string, config: TeamModeConfig, sessionID: string | undefined, deps: TeamTaskToolDeps): Promise<string> {
  const runtimeState: RuntimeState = await deps.loadRuntimeState(teamRunId, config)
  const matchedMember = runtimeState.members.find((member) => member.sessionId === sessionID)
  if (matchedMember) return matchedMember.name

  const leadMember = runtimeState.members.find((member) => member.agentType === "leader")
  if (leadMember) return leadMember.name

  throw new Error(`team member not found for session ${sessionID ?? "unknown"}`)
}

export function createTeamTaskCreateTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamTaskToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "Create a pending shared team task. Members claim/update it with team_task_update; track progress and results with team_task_list/team_task_get plus member team_send_message reports.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      subject: tool.schema.string().describe("Short task subject shown in team_task_list."),
      description: tool.schema.string().describe("Concrete assignment and expected result for the member."),
      blockedBy: tool.schema.array(tool.schema.string()).optional().describe("Task IDs that must complete before this task is available."),
    },
    execute: async (args: TeamTaskCreateArgs): Promise<string> => {
      const createdTask: Task = await deps.createTask(args.teamRunId, {
        subject: args.subject,
        description: args.description,
        blocks: [],
        blockedBy: args.blockedBy ?? [],
        status: "pending",
      }, config)

      return JSON.stringify({ taskId: createdTask.id, task: createdTask })
    },
  })
}

export function createTeamTaskListTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamTaskToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "List shared team tasks with owner/status metadata. Use this to track task completion; it does not include member message bodies.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      status: tool.schema.enum(["pending", "claimed", "in_progress", "completed", "deleted"]).optional().describe("Optional status filter."),
      owner: tool.schema.string().optional().describe("Optional member-name owner filter."),
    },
    execute: async (args: TeamTaskListArgs): Promise<string> => {
      const tasks = await deps.listTasks(args.teamRunId, config, { status: args.status, owner: args.owner })
      return JSON.stringify({ tasks })
    },
  })
}

export function createTeamTaskUpdateTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamTaskToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "Claim, start, complete, or delete a shared team task. Members should report substantive results separately with team_send_message.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      taskId: tool.schema.string().describe("Task ID"),
      status: tool.schema.enum(["pending", "claimed", "in_progress", "completed", "deleted"]).describe("New task status: claimed/in_progress while working, completed when done, deleted to remove."),
    },
    execute: async (args: TeamTaskUpdateArgs, ctx?: TeamTaskToolContext): Promise<string> => {
      const senderName = await resolveSenderName(args.teamRunId, config, ctx?.sessionID, deps)

      const updatedTask = args.status === "claimed"
        ? await deps.claimTask(args.teamRunId, args.taskId, senderName, config)
        : await deps.updateTaskStatus(args.teamRunId, args.taskId, args.status, senderName, config)

      return JSON.stringify({ task: updatedTask })
    },
  })
}

export function createTeamTaskGetTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamTaskToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "Get one shared team task with its current owner/status metadata. It is for task state, not conversation history.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      taskId: tool.schema.string().describe("Task ID"),
    },
    execute: async (args: TeamTaskGetArgs): Promise<string> => {
      const task = await deps.getTask(args.teamRunId, args.taskId, config)
      return JSON.stringify({ task })
    },
  })
}
