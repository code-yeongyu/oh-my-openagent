import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { TaskUpdateInputSchema, TaskObjectSchema } from "./types"
import { acquireLock, getTaskDir, readJsonSafe, writeJsonAtomic } from "../../features/claude-tasks/storage"
import { parseTaskId } from "./task-id-validator"

export async function handleUpdate(
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
