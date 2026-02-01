import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { TaskSchema, TaskStatusSchema, type Task, type TaskStatus } from "../../features/claude-tasks/types"
import { getTaskDir, readJsonSafe, writeJsonAtomic, acquireLock } from "../../features/claude-tasks/storage"
import type { OhMyOpenCodeConfig } from "../../config/schema"

export function createTaskUpdate(config: Partial<OhMyOpenCodeConfig>, teamName: string) {
  return tool({
    description: `Update a task in the team's task list.

- Setting status to \`deleted\` permanently removes the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
Tasks are assigned using TaskUpdate with the \`owner\` parameter. Any agent can set or change task ownership via TaskUpdate.`,
    args: {
      taskId: tool.schema.string().describe("Task ID to update"),
      subject: tool.schema.string().optional().describe("New subject"),
      description: tool.schema.string().optional().describe("New description"),
      activeForm: tool.schema.string().optional().describe("New activeForm"),
      status: tool.schema.enum(["pending", "in_progress", "completed", "deleted"]).optional().describe("New status"),
      addBlocks: tool.schema.array(tool.schema.string()).optional().describe("Task IDs to add to blocks"),
      addBlockedBy: tool.schema.array(tool.schema.string()).optional().describe("Task IDs to add to blockedBy"),
      owner: tool.schema.string().optional().describe("Agent name to assign"),
      metadata: tool.schema.object({}).optional().describe("Metadata to merge"),
    },
    execute: async (args) => {
      const taskDir = getTaskDir(teamName, config)
      const lock = acquireLock(taskDir)

      try {
        const taskPath = join(taskDir, `${args.taskId}.json`)
        const task = readJsonSafe(taskPath, TaskSchema)

        if (!task) {
          return JSON.stringify({
            success: false,
            taskId: args.taskId,
            updatedFields: [],
            error: "task_not_found",
          })
        }

        if (task.status === "completed" || task.status === "deleted") {
          return JSON.stringify({
            success: false,
            taskId: args.taskId,
            updatedFields: [],
            error: "already_resolved",
          })
        }

        if (args.status === "in_progress" && task.blockedBy.length > 0) {
          const files = existsSync(taskDir) ? readdirSync(taskDir).filter((f) => f.endsWith(".json")) : []
          const blockerTasks = files
            .map((f) => readJsonSafe(join(taskDir, f), TaskSchema))
            .filter((t): t is Task => t !== null && task.blockedBy.includes(t.id))

          const hasIncompleteBlockers = blockerTasks.some((t) => t.status !== "completed")
          if (hasIncompleteBlockers) {
            return JSON.stringify({
              success: false,
              taskId: args.taskId,
              updatedFields: [],
              error: "blocked",
            })
          }
        }

        if (args.status === "in_progress" && args.owner) {
          const files = existsSync(taskDir) ? readdirSync(taskDir).filter((f) => f.endsWith(".json")) : []
          const ownerTasks = files
            .map((f) => readJsonSafe(join(taskDir, f), TaskSchema))
            .filter((t): t is Task => t !== null && t.owner === args.owner && t.id !== args.taskId)

          const hasInProgressTask = ownerTasks.some((t) => t.status === "in_progress")
          if (hasInProgressTask) {
            return JSON.stringify({
              success: false,
              taskId: args.taskId,
              updatedFields: [],
              error: "agent_busy",
            })
          }
        }

        const updatedFields: string[] = []
        const oldStatus = task.status

        if (args.subject !== undefined) {
          task.subject = args.subject
          updatedFields.push("subject")
        }
        if (args.description !== undefined) {
          task.description = args.description
          updatedFields.push("description")
        }
        if (args.activeForm !== undefined) {
          task.activeForm = args.activeForm
          updatedFields.push("activeForm")
        }
        if (args.status !== undefined) {
          task.status = args.status
          updatedFields.push("status")
        }
        if (args.addBlocks !== undefined) {
          task.blocks = [...new Set([...task.blocks, ...args.addBlocks])]
          updatedFields.push("blocks")
        }
        if (args.addBlockedBy !== undefined) {
          task.blockedBy = [...new Set([...task.blockedBy, ...args.addBlockedBy])]
          updatedFields.push("blockedBy")
        }
        if (args.owner !== undefined) {
          task.owner = args.owner
          updatedFields.push("owner")
        }
        if (args.metadata !== undefined) {
          task.metadata = { ...task.metadata, ...args.metadata }
          updatedFields.push("metadata")
        }

        const validatedTask = TaskSchema.parse(task)
        writeJsonAtomic(taskPath, validatedTask)

        const result: {
          success: boolean
          taskId: string
          updatedFields: string[]
          statusChange?: { from: TaskStatus; to: TaskStatus }
        } = {
          success: true,
          taskId: args.taskId,
          updatedFields,
        }

        if (args.status !== undefined && oldStatus !== args.status) {
          result.statusChange = { from: oldStatus, to: args.status }
        }

        return JSON.stringify(result)
      } finally {
        lock.release()
      }
    },
  })
}
