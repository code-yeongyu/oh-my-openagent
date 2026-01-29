import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeStorageDir } from "../data-path"

export interface ZellijState {
  sessionID: string
  anchorPaneId: string | null
  hasCreatedFirstPane: boolean
  updatedAt: number
}

const ZELLIJ_ADAPTER_STORAGE = join(
  getOpenCodeStorageDir(),
  "zellij-adapter",
)

function getStoragePath(sessionID: string): string {
  return join(ZELLIJ_ADAPTER_STORAGE, `${sessionID}.json`)
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
  if (!existsSync(ZELLIJ_ADAPTER_STORAGE)) {
    mkdirSync(ZELLIJ_ADAPTER_STORAGE, { recursive: true })
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
