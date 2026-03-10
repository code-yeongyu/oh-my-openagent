import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOmoOpenCodeCacheDir } from "../../shared"
import { MODEL_HEALTH_FILE, MODEL_SCHEDULER_AUDIT_FILE } from "./constants"
import type { ModelHealthSnapshot, ModelSchedulerAuditEntry } from "./types"

function ensureParentDir(filePath: string): void {
  const parentDir = dirname(filePath)
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureParentDir(filePath)
  const tempPath = `${filePath}.tmp.${Date.now()}`

  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath)
    }
    throw error
  }
}

export function getModelHealthFilePath(): string {
  return join(getOmoOpenCodeCacheDir(), MODEL_HEALTH_FILE)
}

export function getModelSchedulerAuditFilePath(): string {
  return join(getOmoOpenCodeCacheDir(), MODEL_SCHEDULER_AUDIT_FILE)
}

export function readModelHealthSnapshot(): ModelHealthSnapshot | null {
  const filePath = getModelHealthFilePath()
  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, "utf-8")
    return JSON.parse(raw) as ModelHealthSnapshot
  } catch {
    return null
  }
}

export function writeModelHealthSnapshot(snapshot: ModelHealthSnapshot): void {
  writeJsonAtomic(getModelHealthFilePath(), snapshot)
}

export function appendModelSchedulerAuditEntry(entry: ModelSchedulerAuditEntry): void {
  const filePath = getModelSchedulerAuditFilePath()
  ensureParentDir(filePath)
  writeFileSync(filePath, `${JSON.stringify(entry)}\n`, {
    encoding: "utf-8",
    flag: "a",
  })
}
