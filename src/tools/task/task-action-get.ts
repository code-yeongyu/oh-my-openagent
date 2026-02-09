import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { TaskGetInputSchema, TaskObjectSchema } from "./types"
import { getTaskDir, readJsonSafe } from "../../features/claude-tasks/storage"
import { parseTaskId } from "./task-id-validator"

export async function handleGet(
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
