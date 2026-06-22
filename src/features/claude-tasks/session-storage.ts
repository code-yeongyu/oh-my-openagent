import { existsSync, readdirSync, statSync } from "fs"
import { join } from "path"
import type { MatrixxConfig } from "../../config/schema"
import { getTaskDir } from "./storage"

export function getSessionTaskDir(
  config: Partial<MatrixxConfig>,
  sessionID: string,
): string {
  return join(getTaskDir(config), sessionID)
}

export function listSessionTaskFiles(
  config: Partial<MatrixxConfig>,
  sessionID: string,
): string[] {
  const dir = getSessionTaskDir(config, sessionID)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f.startsWith("T-"))
    .map((f) => f.replace(".json", ""))
}

export function listAllSessionDirs(
  config: Partial<MatrixxConfig>,
): string[] {
  const baseDir = getTaskDir(config)
  if (!existsSync(baseDir)) return []
  return readdirSync(baseDir).filter((entry) => {
    const fullPath = join(baseDir, entry)
    return statSync(fullPath).isDirectory()
  })
}

export interface TaskLocation {
  path: string
  sessionID: string
}

export function findTaskAcrossSessions(
  config: Partial<MatrixxConfig>,
  taskId: string,
): TaskLocation | null {
  const sessionDirs = listAllSessionDirs(config)
  for (const sessionID of sessionDirs) {
    const taskPath = join(getSessionTaskDir(config, sessionID), `${taskId}.json`)
    if (existsSync(taskPath)) {
      return { path: taskPath, sessionID }
    }
  }
  return null
}
