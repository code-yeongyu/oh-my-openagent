import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../../shared/logger"

const LOOP_STATE_DIR = ".sisyphus/loop-state"
const MAX_LOOP_STATE_AGE_MS = 60 * 60 * 1000 // 1 hour

interface PersistedLoopState {
  sessionID: string
  updatedAt: string
  consecutiveClarifications: number
  consecutiveFailures: number
  stagnationCount: number
}

function getStatePath(directory: string, sessionID: string): string {
  return join(directory, LOOP_STATE_DIR, `${sessionID}.json`)
}

export function persistLoopState(
  directory: string,
  sessionID: string,
  state: {
    consecutiveClarifications: number
    consecutiveFailures: number
    stagnationCount: number
  },
): void {
  const data: PersistedLoopState = {
    sessionID,
    updatedAt: new Date().toISOString(),
    consecutiveClarifications: state.consecutiveClarifications,
    consecutiveFailures: state.consecutiveFailures,
    stagnationCount: state.stagnationCount,
  }

  try {
    const statePath = getStatePath(directory, sessionID)
    mkdirSync(join(directory, LOOP_STATE_DIR), { recursive: true })
    writeFileSync(statePath, JSON.stringify(data, null, 2), "utf-8")
  } catch (error) {
    log(`[loop-state-persistence] Failed to persist loop state`, {
      sessionID,
      error: String(error),
    })
  }
}

export function loadLoopState(
  directory: string,
  sessionID: string,
): PersistedLoopState | null {
  const statePath = getStatePath(directory, sessionID)
  if (!existsSync(statePath)) return null

  try {
    const raw = readFileSync(statePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

    const updatedAt = typeof parsed.updatedAt === "string" ? new Date(parsed.updatedAt).getTime() : NaN
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > MAX_LOOP_STATE_AGE_MS) {
      log(`[loop-state-persistence] Loop state expired, ignoring (age: ${Date.now() - updatedAt}ms, max: ${MAX_LOOP_STATE_AGE_MS}ms)`, { sessionID })
      rmSync(statePath, { force: true })
      return null
    }

    return {
      sessionID: parsed.sessionID ?? sessionID,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      consecutiveClarifications:
        typeof parsed.consecutiveClarifications === "number"
          ? parsed.consecutiveClarifications
          : 0,
      consecutiveFailures:
        typeof parsed.consecutiveFailures === "number"
          ? parsed.consecutiveFailures
          : 0,
      stagnationCount:
        typeof parsed.stagnationCount === "number"
          ? parsed.stagnationCount
          : 0,
    }
  } catch {
    return null
  }
}

export function clearLoopState(directory: string, sessionID: string): void {
  const statePath = getStatePath(directory, sessionID)
  if (!existsSync(statePath)) return

  try {
    rmSync(statePath)
  } catch {
  }
}
