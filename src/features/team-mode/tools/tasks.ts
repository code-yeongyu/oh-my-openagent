import { tool, type ToolDefinition, type ToolContext } from "@opencode-ai/plugin/tool"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import { loadRuntimeState } from "../team-state-store"
import { createTask, getTask, listTasks, updateTaskStatus, claimTask } from "../team-tasklist"

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

async function resolveSenderName(teamRunId: string, config: TeamModeConfig, sessionID: string | undefined): Promise<string> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  const matchedMember = runtimeState.members.find((member) => member.sessionId === sessionID)
  if (matchedMember) return matchedMember.name

  const leadMember = runtimeState.members.find((member) => member.agentType === "leader")
  if (leadMember) return leadMember.name

  throw new Error(`team member not found for session ${sessionID ?? "unknown"}`)
}

export function createTeamTaskCreateTool(config: TeamModeConfig, client: OpencodeClient): ToolDefinition {
  void client

  return tool({
    description: "Create a team task.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      subject: tool.schema.string().describe("Task subject"),
      description: tool.schema.string().describe("Task description"),
      blockedBy: tool.schema.array(tool.schema.string()).optional().describe("Blocking task IDs"),
    },
    execute: async (args: TeamTaskCreateArgs): Promise<string> => {
      const createdTask = await createTask(args.teamRunId, {
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

export function createTeamTaskListTool(config: TeamModeConfig, client: OpencodeClient): ToolDefinition {
  void client

  return tool({
    description: "List team tasks.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      status: tool.schema.enum(["pending", "claimed", "in_progress", "completed", "deleted"]).optional(),
      owner: tool.schema.string().optional(),
    },
    execute: async (args: TeamTaskListArgs): Promise<string> => {
      const tasks = await listTasks(args.teamRunId, config, { status: args.status, owner: args.owner })
      return JSON.stringify({ tasks })
    },
  })
}

export function createTeamTaskUpdateTool(config: TeamModeConfig, client: OpencodeClient): ToolDefinition {
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
      const senderName = await resolveSenderName(args.teamRunId, config, ctx?.sessionID)

      const updatedTask = args.status === "claimed"
        ? await claimTask(args.teamRunId, args.taskId, senderName, config)
        : await updateTaskStatus(args.teamRunId, args.taskId, args.status, args.owner ?? senderName, config)

      return JSON.stringify({ task: updatedTask })
    },
  })
}

export function createTeamTaskGetTool(config: TeamModeConfig, client: OpencodeClient): ToolDefinition {
  void client

  return tool({
    description: "Get a team task.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      taskId: tool.schema.string().describe("Task ID"),
    },
    execute: async (args: TeamTaskGetArgs): Promise<string> => {
      const task = await getTask(args.teamRunId, args.taskId, config)
      return JSON.stringify({ task })
    },
  })
}
