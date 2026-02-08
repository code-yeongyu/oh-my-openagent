import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { sendStructuredInboxMessage } from "./inbox-store"
import { readTeamConfigOrThrow } from "./team-config-store"
import { validateAgentName, validateTaskId, validateTeamName } from "./name-validation"
import {
  TeamTaskCreateInputSchema,
  TeamTaskGetInputSchema,
  TeamTaskListInputSchema,
  TeamTask,
} from "./types"
import { createTeamTask, listTeamTasks, readTeamTask } from "./team-task-store"

function buildTaskAssignmentPayload(task: TeamTask): Record<string, unknown> {
  return {
    type: "task_assignment",
    taskId: task.id,
    subject: task.subject,
    description: task.description,
    timestamp: new Date().toISOString(),
  }
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
    execute: async (args: Record<string, unknown>): Promise<string> => {
      try {
        const input = TeamTaskCreateInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        readTeamConfigOrThrow(input.team_name)

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
    execute: async (args: Record<string, unknown>): Promise<string> => {
      try {
        const input = TeamTaskListInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        readTeamConfigOrThrow(input.team_name)
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
    execute: async (args: Record<string, unknown>): Promise<string> => {
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
        readTeamConfigOrThrow(input.team_name)
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

export function notifyOwnerAssignment(teamName: string, task: TeamTask): void {
  if (!task.owner || task.status === "deleted") {
    return
  }

  if (validateTeamName(teamName)) {
    return
  }

  if (validateAgentName(task.owner)) {
    return
  }

  sendStructuredInboxMessage(
    teamName,
    "team-lead",
    task.owner,
    buildTaskAssignmentPayload(task),
    "task_assignment",
  )
}
