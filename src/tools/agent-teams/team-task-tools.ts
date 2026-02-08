import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { sendStructuredInboxMessage } from "./inbox-store"
import { readTeamConfigOrThrow } from "./team-config-store"
import { validateAgentNameOrLead, validateTaskId, validateTeamName } from "./name-validation"
import {
  TeamConfig,
  TeamTaskCreateInputSchema,
  TeamTaskGetInputSchema,
  TeamTaskListInputSchema,
  TeamTask,
  TeamToolContext,
  isTeammateMember,
} from "./types"
import { createTeamTask, listTeamTasks, readTeamTask } from "./team-task-store"

function buildTaskAssignmentPayload(task: TeamTask, assignedBy: string): Record<string, unknown> {
  return {
    type: "task_assignment",
    taskId: task.id,
    subject: task.subject,
    description: task.description,
    assignedBy,
    timestamp: new Date().toISOString(),
  }
}

export function resolveTaskActorFromContext(config: TeamConfig, context: TeamToolContext): "team-lead" | string | null {
  if (context.sessionID === config.leadSessionId) {
    return "team-lead"
  }

  const matchedMember = config.members.find((member) => isTeammateMember(member) && member.sessionID === context.sessionID)
  return matchedMember?.name ?? null
}

export function createTeamTaskCreateTool(): ToolDefinition {
  return tool({
    description: "Create a task in team-scoped storage.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      subject: tool.schema.string().describe("Task subject"),
      description: tool.schema.string().describe("Task description"),
      active_form: tool.schema.string().optional().describe("Present-continuous form"),
      metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Task metadata"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamTaskCreateInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        const config = readTeamConfigOrThrow(input.team_name)
        const actor = resolveTaskActorFromContext(config, context)
        if (!actor) {
          return JSON.stringify({ error: "unauthorized_task_session" })
        }

        const task = createTeamTask(
          input.team_name,
          input.subject,
          input.description,
          input.active_form,
          input.metadata,
        )

        return JSON.stringify(task)
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "team_task_create_failed" })
      }
    },
  })
}

export function createTeamTaskListTool(): ToolDefinition {
  return tool({
    description: "List tasks for one team.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamTaskListInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        const config = readTeamConfigOrThrow(input.team_name)
        const actor = resolveTaskActorFromContext(config, context)
        if (!actor) {
          return JSON.stringify({ error: "unauthorized_task_session" })
        }
        return JSON.stringify(listTeamTasks(input.team_name))
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "team_task_list_failed" })
      }
    },
  })
}

export function createTeamTaskGetTool(): ToolDefinition {
  return tool({
    description: "Get one task from team-scoped storage.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      task_id: tool.schema.string().describe("Task id"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamTaskGetInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        const taskIdError = validateTaskId(input.task_id)
        if (taskIdError) {
          return JSON.stringify({ error: taskIdError })
        }
        const config = readTeamConfigOrThrow(input.team_name)
        const actor = resolveTaskActorFromContext(config, context)
        if (!actor) {
          return JSON.stringify({ error: "unauthorized_task_session" })
        }
        const task = readTeamTask(input.team_name, input.task_id)
        if (!task) {
          return JSON.stringify({ error: "team_task_not_found" })
        }
        return JSON.stringify(task)
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "team_task_get_failed" })
      }
    },
  })
}

export function notifyOwnerAssignment(teamName: string, task: TeamTask, assignedBy: string): void {
  if (!task.owner || task.status === "deleted") {
    return
  }

  if (validateTeamName(teamName)) {
    return
  }

  if (validateAgentNameOrLead(task.owner)) {
    return
  }

  if (validateAgentNameOrLead(assignedBy)) {
    return
  }

  sendStructuredInboxMessage(
    teamName,
    assignedBy,
    task.owner,
    buildTaskAssignmentPayload(task, assignedBy),
    "task_assignment",
  )
}
