import { existsSync } from "fs"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { TaskObject } from "./types"
import { TaskListInputSchema, TaskObjectSchema } from "./types"
import { getTaskDir, listTaskFiles, readJsonSafe } from "../../features/claude-tasks/storage"

export async function handleList(
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

  let tasks = allTasks.filter((task) => task.status !== "completed")

  if (validatedArgs.status) {
    tasks = tasks.filter((task) => task.status === validatedArgs.status)
  }

  if (validatedArgs.parentID) {
    tasks = tasks.filter((task) => task.parentID === validatedArgs.parentID)
  }

  const ready = args["ready"] === true
  if (ready) {
    tasks = tasks.filter((task) => {
      if (task.blockedBy.length === 0) return true
      return task.blockedBy.every((depId) => {
        const depTask = allTasks.find((t) => t.id === depId)
        return depTask?.status === "completed"
      })
    })
  }

  const limitRaw = args["limit"]
  const limit = typeof limitRaw === "number" ? limitRaw : undefined
  if (limit !== undefined && limit > 0) {
    tasks = tasks.slice(0, limit)
  }

  return JSON.stringify({ tasks })
}
