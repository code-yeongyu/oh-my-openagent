import { existsSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { HANDOFF_FILE_PATH, HANDOFF_CONSUMED_FILE_PATH } from "./constants"

export function getHandoffFilePath(directory: string): string {
  return join(directory, HANDOFF_FILE_PATH)
}

export function getHandoffConsumedFilePath(directory: string): string {
  return join(directory, HANDOFF_CONSUMED_FILE_PATH)
}

export function handoffFileExists(directory: string): boolean {
  try {
    return existsSync(getHandoffFilePath(directory))
  } catch {
    return false
  }
}

export function readHandoffFile(directory: string): string | null {
  const filePath = getHandoffFilePath(directory)
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

export function archiveHandoffFile(directory: string): boolean {
  try {
    renameSync(
      getHandoffFilePath(directory),
      getHandoffConsumedFilePath(directory),
    )
    return true
  } catch {
    return false
  }
}
