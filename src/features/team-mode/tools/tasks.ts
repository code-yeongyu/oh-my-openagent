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
  owner?: string
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

async function resolveParticipant(teamRunId: string, config: TeamModeConfig, sessionID: string | undefined, deps: TeamTaskToolDeps): Promise<RuntimeState["members"][number]> {
  const runtimeState: RuntimeState = await deps.loadRuntimeState(teamRunId, config)
  const matchedMember = runtimeState.members.find((member) => member.sessionId === sessionID)
  if (matchedMember) return matchedMember
  throw new Error(`team participant not found for session ${sessionID ?? "unknown"}`)
}

async function assertBlockedByTasksExist(teamRunId: string, blockedBy: string[] | undefined, config: TeamModeConfig, deps: TeamTaskToolDeps): Promise<void> {
  for (const blockedTaskId of blockedBy ?? []) {
    try {
      await deps.getTask(teamRunId, blockedTaskId, config)
    } catch {
      throw new Error(`blockedBy task '${blockedTaskId}' does not exist`)
    }
  }
}

export function createTeamTaskCreateTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamTaskToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "Create a team task.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      subject: tool.schema.string().describe("Task subject"),
      description: tool.schema.string().describe("Task description"),
      blockedBy: tool.schema.array(tool.schema.string()).optional().describe("Blocking task IDs"),
    },
    execute: async (args: TeamTaskCreateArgs, ctx?: TeamTaskToolContext): Promise<string> => {
      await resolveParticipant(args.teamRunId, config, ctx?.sessionID, deps)
      await assertBlockedByTasksExist(args.teamRunId, args.blockedBy, config, deps)
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
    description: "List team tasks.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      status: tool.schema.enum(["pending", "claimed", "in_progress", "completed", "deleted"]).optional(),
      owner: tool.schema.string().optional(),
    },
    execute: async (args: TeamTaskListArgs, ctx?: TeamTaskToolContext): Promise<string> => {
      await resolveParticipant(args.teamRunId, config, ctx?.sessionID, deps)
      const tasks = await deps.listTasks(args.teamRunId, config, { status: args.status, owner: args.owner })
      return JSON.stringify({ tasks })
    },
  })
}

export function createTeamTaskUpdateTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamTaskToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "Update a team task.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      taskId: tool.schema.string().describe("Task ID"),
      status: tool.schema.enum(["pending", "claimed", "in_progress", "completed", "deleted"]).describe("Task status"),
      owner: tool.schema.string().optional().describe("Task owner"),
    },
    execute: async (args: TeamTaskUpdateArgs, ctx?: TeamTaskToolContext): Promise<string> => {
      const participant = await resolveParticipant(args.teamRunId, config, ctx?.sessionID, deps)
      const senderName = participant.name

      const updatedTask = args.status === "claimed"
        ? await deps.claimTask(args.teamRunId, args.taskId, senderName, config)
        : await deps.updateTaskStatus(args.teamRunId, args.taskId, args.status, {
            memberName: senderName,
            isLead: participant.agentType === "leader",
          }, config)

      return JSON.stringify({ task: updatedTask })
    },
  })
}

export function createTeamTaskGetTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamTaskToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "Get a team task.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      taskId: tool.schema.string().describe("Task ID"),
    },
    execute: async (args: TeamTaskGetArgs, ctx?: TeamTaskToolContext): Promise<string> => {
      await resolveParticipant(args.teamRunId, config, ctx?.sessionID, deps)
      const task = await deps.getTask(args.teamRunId, args.taskId, config)
      return JSON.stringify({ task })
    },
  })
}
