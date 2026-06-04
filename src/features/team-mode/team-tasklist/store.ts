import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getTasksDir, resolveBaseDir } from "../team-registry"
import { atomicWrite, withLock } from "../team-state-store/locks"
import { TaskSchema } from "../types"
import type { Task } from "../types"

const HIGH_WATERMARK_FILE = ".highwatermark"

async function readHighWatermark(watermarkPath: string): Promise<number> {
  try {
    const watermarkContent = (await readFile(watermarkPath, "utf8")).trim()
    const parsedWatermark = Number.parseInt(watermarkContent, 10)
    return Number.isInteger(parsedWatermark) && parsedWatermark >= 0 ? parsedWatermark : 0
  } catch {
    await atomicWrite(watermarkPath, "0")
    return 0
  }
}

export async function createTask(
  teamRunId: string,
  taskInput: Omit<Task, "id" | "createdAt" | "updatedAt" | "version">,
  config: TeamModeConfig,
): Promise<Task> {
  const tasksDirectory = getTasksDir(resolveBaseDir(config), teamRunId)
  await mkdir(tasksDirectory, { recursive: true, mode: 0o700 })
  await mkdir(path.join(tasksDirectory, "claims"), { recursive: true, mode: 0o700 })

  return withLock(path.join(tasksDirectory, ".lock"), async () => {
    const watermarkPath = path.join(tasksDirectory, HIGH_WATERMARK_FILE)
    const nextTaskId = (await readHighWatermark(watermarkPath)) + 1
    await atomicWrite(watermarkPath, String(nextTaskId))

    const now = Date.now()
    const task = TaskSchema.parse({
      ...taskInput,
      version: 1,
      id: String(nextTaskId),
      createdAt: now,
      updatedAt: now,
    })

    await atomicWrite(
      path.join(tasksDirectory, `${task.id}.json`),
      `${JSON.stringify(task, null, 2)}\n`,
    )

    return task
  }, { ownerTag: `create-task:${teamRunId}` })
}
