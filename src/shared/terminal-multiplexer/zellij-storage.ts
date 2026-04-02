import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeStorageDir } from "../data-path"

export interface ZellijState {
  sessionID: string
  anchorPaneId: string | null
  hasCreatedFirstPane: boolean
  updatedAt: number
}

export interface ZellijStorage {
  loadZellijState(sessionID: string): ZellijState | null
  saveZellijState(state: ZellijState): void
  clearZellijState(sessionID: string): void
}

function getZellijStorageDir(): string {
  return join(getOpenCodeStorageDir(), "zellij-adapter")
}

function getStoragePath(sessionID: string): string {
  if (!/^[a-zA-Z0-9_\-]+$/.test(sessionID)) {
    throw new Error(`Invalid sessionID for storage path: ${JSON.stringify(sessionID)}`)
  }
  return join(getZellijStorageDir(), `${sessionID}.json`)
}

export function loadZellijState(sessionID: string): ZellijState | null {
  const filePath = getStoragePath(sessionID)
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed: unknown = JSON.parse(content)

    const record = parsed as Record<string, unknown>
    const anchorPaneId = record.anchorPaneId
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof record.sessionID !== "string" ||
      (typeof anchorPaneId !== "string" && anchorPaneId !== null) ||
      typeof record.hasCreatedFirstPane !== "boolean" ||
      typeof record.updatedAt !== "number"
    ) {
      return null
    }

    return parsed as ZellijState
  } catch {
    return null
  }
}

export function saveZellijState(state: ZellijState): void {
  const storageDir = getZellijStorageDir()
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true })
  }

  const filePath = getStoragePath(state.sessionID)
  writeFileSync(filePath, JSON.stringify(state, null, 2))
}

export function clearZellijState(sessionID: string): void {
  const filePath = getStoragePath(sessionID)
  try {
    unlinkSync(filePath)
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }
}

export const defaultZellijStorage: ZellijStorage = {
  loadZellijState,
  saveZellijState,
  clearZellijState,
}
