import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { TaskObject } from "./types"
import { TaskCreateInputSchema, TaskObjectSchema } from "./types"
import {
  acquireLock,
  generateTaskId,
  getTaskDir,
  writeJsonAtomic,
} from "../../features/claude-tasks/storage"

export async function handleCreate(
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
