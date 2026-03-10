import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeConfigDir } from "../../shared"
import { MODEL_ROUTING_FILE } from "./constants"
import type { ModelRoutingFile } from "./types"

function writeJsonAtomic(filePath: string, data: unknown): void {
  const parentDir = dirname(filePath)
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }

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

export function getModelRoutingFilePath(): string {
  return join(getOpenCodeConfigDir({ binary: "opencode", version: null }), MODEL_ROUTING_FILE)
}

export function readModelRoutingFile(): ModelRoutingFile | null {
  const filePath = getModelRoutingFilePath()
  if (!existsSync(filePath)) return null

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ModelRoutingFile
  } catch {
    return null
  }
}

export function writeModelRoutingFile(routing: ModelRoutingFile): void {
  writeJsonAtomic(getModelRoutingFilePath(), routing)
}
