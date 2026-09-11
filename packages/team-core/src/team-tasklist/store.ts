import type { Dirent } from "node:fs"
import { mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getTaskFilePath, getTasksDir, resolveBaseDir } from "../team-registry"
import { atomicWrite, withLock } from "../team-state-store/locks"
import { TaskSchema } from "../types"
import type { Task } from "../types"

const HIGH_WATERMARK_FILE = ".highwatermark"

function errorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}

async function readTaskFileHighWatermark(tasksDirectory: string): Promise<number> {
  let entries: Dirent[]
  try {
    entries = await readdir(tasksDirectory, { withFileTypes: true })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if (errorCode(error) === "ENOENT") return 0
    throw error
  }

  return entries.reduce((maxTaskId, entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return maxTaskId
    const taskFileStem = path.basename(entry.name, ".json")
    if (!/^\d+$/.test(taskFileStem)) return maxTaskId
    const taskId = Number.parseInt(taskFileStem, 10)
    return Number.isInteger(taskId) && taskId > maxTaskId ? taskId : maxTaskId
  }, 0)
}

async function readHighWatermark(watermarkPath: string, tasksDirectory: string): Promise<number> {
  let parsedWatermark: number | null = null
  try {
    const watermarkContent = (await readFile(watermarkPath, "utf8")).trim()
    const parsedValue = Number.parseInt(watermarkContent, 10)
    if (Number.isInteger(parsedValue) && parsedValue >= 0) {
      parsedWatermark = parsedValue
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }

  const recoveredWatermark = await readTaskFileHighWatermark(tasksDirectory)
  const nextWatermark = Math.max(parsedWatermark ?? 0, recoveredWatermark)
  if (parsedWatermark !== nextWatermark) {
    await atomicWrite(watermarkPath, String(nextWatermark))
  }
  return nextWatermark
}

export async function createTask(
  teamRunId: string,
  taskInput: Omit<Task, "id" | "createdAt" | "updatedAt" | "version">,
  config: TeamModeConfig,
): Promise<Task> {
  const baseDirectory = resolveBaseDir(config)
  const tasksDirectory = getTasksDir(baseDirectory, teamRunId)
  await mkdir(tasksDirectory, { recursive: true, mode: 0o700 })
  await mkdir(path.join(tasksDirectory, "claims"), { recursive: true, mode: 0o700 })

  return withLock(path.join(tasksDirectory, ".lock"), async () => {
    const watermarkPath = path.join(tasksDirectory, HIGH_WATERMARK_FILE)
    const nextTaskId = (await readHighWatermark(watermarkPath, tasksDirectory)) + 1
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
      getTaskFilePath(baseDirectory, teamRunId, task.id),
      `${JSON.stringify(task, null, 2)}\n`,
    )

    return task
  }, { ownerTag: `create-task:${teamRunId}` })
}
