import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { TaskGetInput } from "./types"
import { TaskGetInputSchema, TaskObjectSchema } from "./types"
import { getTaskDir, readJsonSafe } from "../../features/claude-tasks/storage"

const TASK_ID_PATTERN = /^T-[A-Za-z0-9-]+$/

function parseTaskId(id: string): string | null {
  if (!TASK_ID_PATTERN.test(id)) return null
  return id
}

export function createTaskGetTool(config: Partial<OhMyOpenCodeConfig>): ToolDefinition {
  return tool({
    description: `Retrieve a task by ID.

Returns the full task object including all fields: id, subject, description, status, activeForm, blocks, blockedBy, owner, metadata, repoURL, parentID, and threadID.

Returns null if the task does not exist or the file is invalid.`,
    args: {
      id: tool.schema.string().describe("Task ID to retrieve (format: T-{uuid})"),
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      try {
        const validatedArgs = TaskGetInputSchema.parse(args)
        const taskId = parseTaskId(validatedArgs.id)

        if (!taskId) {
          return JSON.stringify({ error: "invalid_task_id" })
        }

        const taskDir = getTaskDir(config)
        const taskPath = join(taskDir, `${taskId}.json`)

         const task = readJsonSafe(taskPath, TaskObjectSchema)

        return JSON.stringify({ task: task ?? null })
      } catch (error) {
        if (error instanceof Error && error.message.includes("validation")) {
          return JSON.stringify({ error: "invalid_arguments" })
        }
        return JSON.stringify({ error: "unknown_error" })
      }
    },
  })
}
