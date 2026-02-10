import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type {
  TaskObject,
  TaskCreateInput,
  TaskListInput,
  TaskGetInput,
  TaskUpdateInput,
  TaskDeleteInput,
} from "./types"
import {
  TaskObjectSchema,
  TaskCreateInputSchema,
  TaskListInputSchema,
  TaskGetInputSchema,
  TaskUpdateInputSchema,
  TaskDeleteInputSchema,
} from "./types"
import {
  getTaskDir,
  readJsonSafe,
  writeJsonAtomic,
  acquireLock,
  generateTaskId,
  listTaskFiles,
} from "../../features/claude-tasks/storage"

const TASK_ID_PATTERN = /^T-[A-Za-z0-9-]+$/

function parseTaskId(id: string): string | null {
  if (!TASK_ID_PATTERN.test(id)) return null
  return id
}

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
      const action = args.action as "create" | "list" | "get" | "update" | "delete"

      switch (action) {
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

async function handleCreate(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>,
  context: { sessionID: string }
): Promise<string> {
  const validatedArgs = TaskCreateInputSchema.parse(args)
  const taskDir = getTaskDir(config)
  const lock = acquireLock(taskDir)

  if (!lock.acquired) {
    return JSON.stringify({ error: "task_lock_unavailable" })
  }

   try {
     const taskId = generateTaskId()
     const task: TaskObject = {
       id: taskId,
       subject: validatedArgs.subject,
        description: validatedArgs.description ?? "",
       status: "pending",
       blocks: validatedArgs.blocks ?? [],
       blockedBy: validatedArgs.blockedBy ?? [],
       repoURL: validatedArgs.repoURL,
       parentID: validatedArgs.parentID,
       threadID: context.sessionID,
     }

    const validatedTask = TaskObjectSchema.parse(task)
    writeJsonAtomic(join(taskDir, `${taskId}.json`), validatedTask)

    return JSON.stringify({ task: validatedTask })
  } finally {
    lock.release()
  }
}

async function handleList(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>
): Promise<string> {
  const validatedArgs = TaskListInputSchema.parse(args)
  const taskDir = getTaskDir(config)

  if (!existsSync(taskDir)) {
    return JSON.stringify({ tasks: [] })
  }

  const files = listTaskFiles(config)
  if (files.length === 0) {
    return JSON.stringify({ tasks: [] })
  }

  const allTasks: TaskObject[] = []
  for (const fileId of files) {
    const task = readJsonSafe(join(taskDir, `${fileId}.json`), TaskObjectSchema)
    if (task) {
      allTasks.push(task)
    }
  }

  // Filter out completed tasks by default
  let tasks = allTasks.filter((task) => task.status !== "completed")

  // Apply status filter if provided
  if (validatedArgs.status) {
    tasks = tasks.filter((task) => task.status === validatedArgs.status)
  }

  // Apply parentID filter if provided
  if (validatedArgs.parentID) {
    tasks = tasks.filter((task) => task.parentID === validatedArgs.parentID)
  }

   // Apply ready filter if requested
   if (args.ready) {
     tasks = tasks.filter((task) => {
       if (task.blockedBy.length === 0) {
         return true
       }

       // All blocking tasks must be completed
       return task.blockedBy.every((depId: string) => {
         const depTask = allTasks.find((t) => t.id === depId)
         return depTask?.status === "completed"
       })
     })
   }

  // Apply limit if provided
  const limit = args.limit as number | undefined
  if (limit !== undefined && limit > 0) {
    tasks = tasks.slice(0, limit)
  }

  return JSON.stringify({ tasks })
}

async function handleGet(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>
): Promise<string> {
  const validatedArgs = TaskGetInputSchema.parse(args)
  const taskId = parseTaskId(validatedArgs.id)
  if (!taskId) {
    return JSON.stringify({ error: "invalid_task_id" })
  }
  const taskDir = getTaskDir(config)
  const taskPath = join(taskDir, `${taskId}.json`)

  const task = readJsonSafe(taskPath, TaskObjectSchema)

  return JSON.stringify({ task: task ?? null })
}

async function handleUpdate(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>
): Promise<string> {
  const validatedArgs = TaskUpdateInputSchema.parse(args)
  const taskId = parseTaskId(validatedArgs.id)
  if (!taskId) {
    return JSON.stringify({ error: "invalid_task_id" })
  }
  const taskDir = getTaskDir(config)
  const lock = acquireLock(taskDir)

  if (!lock.acquired) {
    return JSON.stringify({ error: "task_lock_unavailable" })
  }

  try {
    const taskPath = join(taskDir, `${taskId}.json`)
    const task = readJsonSafe(taskPath, TaskObjectSchema)

    if (!task) {
      return JSON.stringify({ error: "task_not_found" })
    }

     // Update fields if provided
     if (validatedArgs.subject !== undefined) {
       task.subject = validatedArgs.subject
     }
     if (validatedArgs.description !== undefined) {
       task.description = validatedArgs.description
     }
     if (validatedArgs.status !== undefined) {
       task.status = validatedArgs.status
     }
     if (validatedArgs.addBlockedBy !== undefined) {
       task.blockedBy = [...task.blockedBy, ...validatedArgs.addBlockedBy]
     }
     if (validatedArgs.repoURL !== undefined) {
       task.repoURL = validatedArgs.repoURL
     }
     if (validatedArgs.parentID !== undefined) {
       task.parentID = validatedArgs.parentID
     }

    const validatedTask = TaskObjectSchema.parse(task)
    writeJsonAtomic(taskPath, validatedTask)

    return JSON.stringify({ task: validatedTask })
  } finally {
    lock.release()
  }
}

async function handleDelete(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>
): Promise<string> {
  const validatedArgs = TaskDeleteInputSchema.parse(args)
  const taskId = parseTaskId(validatedArgs.id)
  if (!taskId) {
    return JSON.stringify({ error: "invalid_task_id" })
  }
  const taskDir = getTaskDir(config)
  const lock = acquireLock(taskDir)

  if (!lock.acquired) {
    return JSON.stringify({ error: "task_lock_unavailable" })
  }

  try {
    const taskPath = join(taskDir, `${taskId}.json`)

    if (!existsSync(taskPath)) {
      return JSON.stringify({ error: "task_not_found" })
    }

    unlinkSync(taskPath)

    return JSON.stringify({ success: true })
  } finally {
    lock.release()
  }
}
