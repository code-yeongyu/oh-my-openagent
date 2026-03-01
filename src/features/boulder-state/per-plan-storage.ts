import { existsSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { BoulderState } from "./types"
import { BOULDER_PLANS_DIR } from "./constants"
import { atomicWriteJson, withFileLock } from "./atomic-file-ops"
import { parseBoulderJson } from "./boulder-json-parser"

function getPlanStatePath(directory: string, planName: string): string {
  return join(directory, BOULDER_PLANS_DIR, `${planName}.json`)
}

function getPlansDir(directory: string): string {
  return join(directory, BOULDER_PLANS_DIR)
}

export function readBoulderStateForPlan(directory: string, planName: string): BoulderState | null {
  const filePath = getPlanStatePath(directory, planName)
  return parseBoulderJson(filePath)
}

export function writeBoulderStateForPlan(directory: string, planName: string, state: BoulderState): boolean {
  const filePath = getPlanStatePath(directory, planName)
  const plansDir = getPlansDir(directory)

  try {
    withFileLock(plansDir, () => {
      atomicWriteJson(filePath, state)
    })
    return true
  } catch {
    return false
  }
}

export function appendSessionIdForPlan(
  directory: string,
  planName: string,
  sessionId: string,
): BoulderState | null {
  const plansDir = getPlansDir(directory)

  try {
    return withFileLock(plansDir, () => {
      const state = readBoulderStateForPlan(directory, planName)
      if (!state) return null

      if (!state.session_ids?.includes(sessionId)) {
        if (!Array.isArray(state.session_ids)) {
          state.session_ids = []
        }
        state.session_ids.push(sessionId)
        const filePath = getPlanStatePath(directory, planName)
        atomicWriteJson(filePath, state)
      }

      return state
    })
  } catch {
    return null
  }
}

export function removeSessionIdForPlan(
  directory: string,
  planName: string,
  sessionId: string,
): BoulderState | null {
  const plansDir = getPlansDir(directory)

  try {
    return withFileLock(plansDir, () => {
      const state = readBoulderStateForPlan(directory, planName)
      if (!state) return null

      if (state.session_ids?.includes(sessionId)) {
        state.session_ids = state.session_ids.filter((id) => id !== sessionId)
        const filePath = getPlanStatePath(directory, planName)
        atomicWriteJson(filePath, state)
      }

      return state
    })
  } catch {
    return null
  }
}


export function clearBoulderStateForPlan(directory: string, planName: string): boolean {
  const filePath = getPlanStatePath(directory, planName)
  const plansDir = getPlansDir(directory)

  try {
    withFileLock(plansDir, () => {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }
    })
    return true
  } catch {
    return false
  }
}

export function listActiveBoulderStates(directory: string): BoulderState[] {
  const plansDir = getPlansDir(directory)
  if (!existsSync(plansDir)) return []

  try {
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".json"))
    const states: BoulderState[] = []

    for (const file of files) {
      const filePath = join(plansDir, file)
      const state = parseBoulderJson(filePath)
      if (state) {
        states.push(state)
      }
    }

    return states
  } catch {
    return []
  }
}

export function findBoulderStateBySession(directory: string, sessionId: string): BoulderState | null {
  const states = listActiveBoulderStates(directory)

  for (const state of states) {
    if (state.session_ids?.includes(sessionId)) {
      return state
    }
  }

  return null
}
