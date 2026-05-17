import type { Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { getTasksDir, resolveBaseDir } from "../team-registry"
import { TaskSchema } from "../types"
import type { Task } from "../types"

type TaskListFilter = {
  status?: Task["status"]
  owner?: string
}

export async function listTasks(
  teamRunId: string,
  config: TeamModeConfig,
  filter?: TaskListFilter,
): Promise<Task[]> {
  const tasksDirectory = getTasksDir(resolveBaseDir(config), teamRunId)

  let entries: Dirent[]
  try {
    entries = await readdir(tasksDirectory, { withFileTypes: true })
  } catch {
    return []
  }

  const parsedTasks: Task[] = []
  for (const entry of entries) {
    if (entry.isDirectory() || entry.name.startsWith(".") || !entry.name.endsWith(".json")) continue

    const taskPath = path.join(tasksDirectory, entry.name)
    try {
      const taskContent = await readFile(taskPath, "utf8")
      const parsedTask = TaskSchema.safeParse(JSON.parse(taskContent))
      if (!parsedTask.success) {
        log("team-tasklist skipped malformed task", {
          event: "team-tasklist-malformed-task",
          taskPath,
          issues: parsedTask.error.issues,
        })
        continue
      }
      parsedTasks.push(parsedTask.data)
    } catch (error) {
      log("team-tasklist skipped malformed task", {
        event: "team-tasklist-malformed-task",
        taskPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return parsedTasks
    .filter((task) => {
      if (filter?.status !== undefined && task.status !== filter.status) {
        return false
      }

      return filter?.owner === undefined || task.owner === filter.owner
    })
    .sort((leftTask, rightTask) => Number.parseInt(leftTask.id, 10) - Number.parseInt(rightTask.id, 10))
}
