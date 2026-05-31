import { readFile } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getTasksDir, resolveBaseDir } from "../team-registry"
import { TaskSchema } from "../types"
import type { Task } from "../types"

export async function getTask(teamRunId: string, taskId: string, config: TeamModeConfig): Promise<Task> {
  const tasksDirectory = getTasksDir(resolveBaseDir(config), teamRunId)
  const taskContent = await readFile(path.join(tasksDirectory, `${taskId}.json`), "utf8")
  return TaskSchema.parse(JSON.parse(taskContent))
}
