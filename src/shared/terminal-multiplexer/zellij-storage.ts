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
    const state = JSON.parse(content) as ZellijState
    return state
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
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

export const defaultZellijStorage: ZellijStorage = {
  loadZellijState,
  saveZellijState,
  clearZellijState,
}
