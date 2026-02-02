import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { Task } from "../../features/claude-tasks/types.ts"

export interface TodoInfo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "low" | "medium" | "high"
}

function mapTaskStatusToTodoStatus(
  taskStatus: Task["status"]
): TodoInfo["status"] | null {
  switch (taskStatus) {
    case "pending":
      return "pending"
    case "in_progress":
      return "in_progress"
    case "completed":
      return "completed"
    case "deleted":
      return null
    default:
      return "pending"
  }
}

function extractPriority(metadata?: Record<string, unknown>): TodoInfo["priority"] | undefined {
  if (!metadata) return undefined

  const priority = metadata.priority
  if (typeof priority === "string" && ["low", "medium", "high"].includes(priority)) {
    return priority as "low" | "medium" | "high"
  }

  return undefined
}

export function syncTaskToTodo(task: Task): TodoInfo | null {
  const todoStatus = mapTaskStatusToTodoStatus(task.status)

  if (todoStatus === null) {
    return null
  }

  return {
    id: task.id,
    content: task.subject,
    status: todoStatus,
    priority: extractPriority(task.metadata),
  }
}

export async function syncAllTasksToTodos(
  ctx: PluginInput,
  tasks: Task[],
  sessionID?: string
): Promise<void> {
  try {
    let currentTodos: TodoInfo[] = []
    try {
      const response = await ctx.client.session.todo({
        path: { id: sessionID || "" },
      })
      currentTodos = (response.data ?? response) as TodoInfo[]
    } catch (err) {
      log("[todo-sync] Failed to fetch current todos", {
        error: String(err),
        sessionID,
      })
    }

    const newTodos: TodoInfo[] = []
    const tasksToRemove = new Set<string>()

    for (const task of tasks) {
      const todo = syncTaskToTodo(task)
      if (todo === null) {
        tasksToRemove.add(task.id)
      } else {
        newTodos.push(todo)
      }
    }

    const finalTodos: TodoInfo[] = []
    const newTodoIds = new Set(newTodos.map(t => t.id))

    for (const existing of currentTodos) {
      if (!newTodoIds.has(existing.id) && !tasksToRemove.has(existing.id)) {
        finalTodos.push(existing)
      }
    }

    finalTodos.push(...newTodos)

    log("[todo-sync] Synced todos", {
      count: finalTodos.length,
      sessionID,
    })
  } catch (err) {
    log("[todo-sync] Error in syncAllTasksToTodos", {
      error: String(err),
      sessionID,
    })
  }
}
