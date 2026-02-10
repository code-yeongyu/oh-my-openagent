import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { handleCreate } from "./task-action-create"
import { handleDelete } from "./task-action-delete"
import { handleGet } from "./task-action-get"
import { handleList } from "./task-action-list"
import { handleUpdate } from "./task-action-update"

export function createTask(config: Partial<OhMyOpenCodeConfig>): ToolDefinition {
  return tool({
    description: `Unified task management tool with create, list, get, update, delete actions.

CREATE: Create a new task. Auto-generates T-{uuid} ID, records threadID, sets status to "pending".
LIST: List tasks. Excludes completed by default. Supports ready filter (all dependencies completed) and limit.
GET: Retrieve a task by ID.
UPDATE: Update task fields. Requires task ID.
DELETE: Physically remove task file.

All actions return JSON strings.`,
    args: {
      action: tool.schema
        .enum(["create", "list", "get", "update", "delete"])
        .describe("Action to perform: create, list, get, update, delete"),
      subject: tool.schema.string().optional().describe("Task subject (required for create)"),
      description: tool.schema.string().optional().describe("Task description"),
      status: tool.schema
        .enum(["pending", "in_progress", "completed", "deleted"])
        .optional()
        .describe("Task status"),
      blockedBy: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Task IDs this task is blocked by"),
      repoURL: tool.schema.string().optional().describe("Repository URL"),
      parentID: tool.schema.string().optional().describe("Parent task ID"),
      id: tool.schema.string().optional().describe("Task ID (required for get, update, delete)"),
      ready: tool.schema.boolean().optional().describe("Filter to tasks with all dependencies completed"),
      limit: tool.schema.number().optional().describe("Maximum number of tasks to return"),
    },
    execute: async (args, context) => {
      switch (args.action) {
        case "create":
          return handleCreate(args, config, context)
        case "list":
          return handleList(args, config)
        case "get":
          return handleGet(args, config)
        case "update":
          return handleUpdate(args, config)
        case "delete":
          return handleDelete(args, config)
        default:
          return JSON.stringify({ error: "invalid_action" })
      }
    },
  })
}
