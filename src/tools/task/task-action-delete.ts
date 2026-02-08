import { existsSync, unlinkSync } from "fs"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { TaskDeleteInputSchema } from "./types"
import { acquireLock, getTaskDir } from "../../features/claude-tasks/storage"
import { parseTaskId } from "./task-id-validator"

export async function handleDelete(
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
