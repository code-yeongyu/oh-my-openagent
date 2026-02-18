import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

export interface PendingSwitch {
  agent: string
  context: string
}

const PENDING_SWITCH_STATE_FILE = process.platform === "win32"
  ? join(tmpdir(), "oh-my-opencode-agent-switch.json")
  : "/tmp/oh-my-opencode-agent-switch.json"

const pendingSwitches = new Map<string, PendingSwitch>()

function isPendingSwitch(value: unknown): value is PendingSwitch {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.agent === "string" && typeof entry.context === "string"
}

function readPersistentState(): Record<string, PendingSwitch> {
  try {
    if (!existsSync(PENDING_SWITCH_STATE_FILE)) {
      return {}
    }

    const raw = readFileSync(PENDING_SWITCH_STATE_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return {}
    }

    const state: Record<string, PendingSwitch> = {}
    for (const [sessionID, value] of Object.entries(parsed)) {
      if (isPendingSwitch(value)) {
        state[sessionID] = value
      }
    }

    return state
  } catch {
    return {}
  }
}

function writePersistentState(state: Record<string, PendingSwitch>): void {
  try {
    const keys = Object.keys(state)
    if (keys.length === 0) {
      rmSync(PENDING_SWITCH_STATE_FILE, { force: true })
      return
    }

    writeFileSync(PENDING_SWITCH_STATE_FILE, JSON.stringify(state), "utf8")
  } catch {
    // ignore persistence errors
  }
}

export function setPendingSwitch(sessionID: string, agent: string, context: string): void {
  const entry = { agent, context }
  pendingSwitches.set(sessionID, entry)

  const state = readPersistentState()
  state[sessionID] = entry
  writePersistentState(state)
}

export function getPendingSwitch(sessionID: string): PendingSwitch | undefined {
  const inMemory = pendingSwitches.get(sessionID)
  if (inMemory) {
    return inMemory
  }

  const state = readPersistentState()
  const fromDisk = state[sessionID]
  if (fromDisk) {
    pendingSwitches.set(sessionID, fromDisk)
  }
  return fromDisk
}

export function clearPendingSwitch(sessionID: string): void {
  pendingSwitches.delete(sessionID)

  const state = readPersistentState()
  delete state[sessionID]
  writePersistentState(state)
}

export function consumePendingSwitch(sessionID: string): PendingSwitch | undefined {
  const entry = getPendingSwitch(sessionID)
  clearPendingSwitch(sessionID)
  return entry
}

/** @internal For testing only */
export function _resetForTesting(): void {
  pendingSwitches.clear()
  rmSync(PENDING_SWITCH_STATE_FILE, { force: true })
}
