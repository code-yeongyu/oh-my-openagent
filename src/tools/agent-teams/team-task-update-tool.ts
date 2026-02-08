import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { readTeamConfigOrThrow } from "./team-config-store"
import { validateAgentName, validateTaskId, validateTeamName } from "./name-validation"
import { TeamTaskUpdateInputSchema } from "./types"
import { updateTeamTask } from "./team-task-update"
import { notifyOwnerAssignment } from "./team-task-tools"

export function createTeamTaskUpdateTool(): ToolDefinition {
  return tool({
    description: "Update task status, owner, dependencies, and metadata in a team task list.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      task_id: tool.schema.string().describe("Task id"),
      status: tool.schema.enum(["pending", "in_progress", "completed", "deleted"]).optional().describe("Task status"),
      owner: tool.schema.string().optional().describe("Task owner"),
      subject: tool.schema.string().optional().describe("Task subject"),
      description: tool.schema.string().optional().describe("Task description"),
      active_form: tool.schema.string().optional().describe("Present-continuous form"),
      add_blocks: tool.schema.array(tool.schema.string()).optional().describe("Add task ids this task blocks"),
      add_blocked_by: tool.schema.array(tool.schema.string()).optional().describe("Add blocker task ids"),
      metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Metadata patch (null removes key)"),
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      try {
        const input = TeamTaskUpdateInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        const taskIdError = validateTaskId(input.task_id)
        if (taskIdError) {
          return JSON.stringify({ error: taskIdError })
        }
        if (input.owner !== undefined) {
          const ownerError = validateAgentName(input.owner)
          if (ownerError) {
            return JSON.stringify({ error: ownerError })
          }
        }
        if (input.add_blocks) {
          for (const blockerId of input.add_blocks) {
            const blockerError = validateTaskId(blockerId)
            if (blockerError) {
              return JSON.stringify({ error: blockerError })
            }
          }
        }
        if (input.add_blocked_by) {
          for (const dependencyId of input.add_blocked_by) {
            const dependencyError = validateTaskId(dependencyId)
            if (dependencyError) {
              return JSON.stringify({ error: dependencyError })
            }
          }
        }
        readTeamConfigOrThrow(input.team_name)

        const task = updateTeamTask(input.team_name, input.task_id, {
          status: input.status,
          owner: input.owner,
          subject: input.subject,
          description: input.description,
          activeForm: input.active_form,
          addBlocks: input.add_blocks,
          addBlockedBy: input.add_blocked_by,
          metadata: input.metadata,
        })

        if (input.owner !== undefined) {
          notifyOwnerAssignment(input.team_name, task)
        }

        return JSON.stringify(task)
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "team_task_update_failed" })
      }
    },
  })
}
