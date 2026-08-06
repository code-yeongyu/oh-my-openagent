import { readFile } from "node:fs/promises"

import type { TeamModeConfig } from "../config"
import { getTaskFilePath, resolveBaseDir } from "../team-registry"
import { TaskSchema } from "../types"
import type { Task } from "../types"

export async function getTask(teamRunId: string, taskId: string, config: TeamModeConfig): Promise<Task> {
  const taskContent = await readFile(getTaskFilePath(resolveBaseDir(config), teamRunId, taskId), "utf8")
  return TaskSchema.parse(JSON.parse(taskContent))
}
