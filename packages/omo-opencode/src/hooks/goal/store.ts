import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GoalFileSchema, type Goal, type GoalFile, type GoalStoreRef, type GoalUpdate } from "./types"

const STORE_VERSION = 2

export function goalFilePath(ref: GoalStoreRef): string {
  return join(ref.baseDir, `${encodeURIComponent(ref.sessionID)}.json`)
}

export function ensureGoalStoreDir(baseDir: string): void {
  mkdirSync(baseDir, { recursive: true })
}

export function readGoal(ref: GoalStoreRef): Goal | null {
  const filePath = goalFilePath(ref)
  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (error) {
    if (isErrorWithCode(error) && error.code === "ENOENT") {
      return null
    }
    throw error
  }

  const parsed = parseGoalFile(raw)
  const goal = parsed.goal
  if (goal && parsed.version === 1) {
    const migrated: Goal = { ...goal, childSessionIDs: goal.childSessionIDs ?? [] }
    writeGoal(ref, migrated)
    return migrated
  }
  return goal
}

export type GoalIndexEntry = {
  readonly sessionIDs: readonly string[]
  readonly parentGoalID?: string
  readonly rootGoalID?: string
  readonly status: string
}

export function goalIndexPath(baseDir: string): string {
  return join(baseDir, "_index.json")
}

export function readGoalIndex(baseDir: string): Record<string, GoalIndexEntry> {
  try {
    const raw = readFileSync(goalIndexPath(baseDir), "utf-8")
    const parsed = JSON.parse(raw) as Record<string, GoalIndexEntry>
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function writeGoalIndexEntry(baseDir: string, goal: Goal | null, sessionID: string): void {
  const path = goalIndexPath(baseDir)
  const index = readGoalIndex(baseDir)
  if (goal === null) {
    for (const [goalID, entry] of Object.entries(index)) {
      const kept = entry.sessionIDs.filter((id) => id !== sessionID)
      if (kept.length === 0) delete index[goalID]
      else index[goalID] = { ...entry, sessionIDs: kept }
    }
  } else {
    const prev = index[goal.id]
    const sessionIDs = prev ? Array.from(new Set([...prev.sessionIDs, sessionID])) : [sessionID]
    index[goal.id] = { sessionIDs, ...(goal.parentGoalID !== undefined ? { parentGoalID: goal.parentGoalID } : {}), ...(goal.rootGoalID !== undefined ? { rootGoalID: goal.rootGoalID } : {}), status: goal.status }
  }
  ensureGoalStoreDir(baseDir)
  writeFileSync(path, JSON.stringify(index, null, 2), "utf-8")
}

export function writeGoal(ref: GoalStoreRef, goal: Goal | null): void {
  ensureGoalStoreDir(ref.baseDir)
  const filePath = goalFilePath(ref)
  const tempPath = `${filePath}.tmp.${randomUUID()}`
  const file: GoalFile = { version: STORE_VERSION, goal }
  writeFileSync(tempPath, JSON.stringify(file, null, 2), "utf-8")
  renameSync(tempPath, filePath)
  writeGoalIndexEntry(ref.baseDir, goal, ref.sessionID)
}

export function clearGoal(ref: GoalStoreRef): boolean {
  const filePath = goalFilePath(ref)
  try {
    unlinkSync(filePath)
    return true
  } catch (error) {
    if (isErrorWithCode(error) && error.code === "ENOENT") {
      return true
    }
    return false
  }
}

export function createGoal(ref: GoalStoreRef, objective: string): Goal {
  const now = nowSeconds()
  const goal: Goal = {
    id: randomUUID(),
    sessionID: ref.sessionID,
    childSessionIDs: [],
    objective: objective.trim(),
    status: "active",
    tokensUsed: 0,
    timeUsedSeconds: 0,
    iteration: 0,
    maxIterations: 100,
    stallCount: 0,
    createdAt: now,
    updatedAt: now,
    lastStartedAt: now,
  }
  writeGoal(ref, goal)
  return goal
}

export function updateGoal(ref: GoalStoreRef, update: GoalUpdate): Goal | null {
  const existing = readGoal(ref)
  if (existing === null) {
    return null
  }

  const now = nowSeconds()
  const updated: Goal = {
    ...existing,
    objective: update.objective ?? existing.objective,
    status: update.status ?? existing.status,
    tokensUsed: update.tokensUsed ?? existing.tokensUsed,
    timeUsedSeconds: update.timeUsedSeconds ?? existing.timeUsedSeconds,
    updatedAt: now,
    ...(update.parentGoalID !== undefined ? { parentGoalID: update.parentGoalID } : {}),
    ...(update.rootGoalID !== undefined ? { rootGoalID: update.rootGoalID } : {}),
    ...(update.childSessionIDs !== undefined ? { childSessionIDs: [...update.childSessionIDs] } : {}),
    ...(update.iteration !== undefined ? { iteration: update.iteration } : {}),
    ...(update.maxIterations !== undefined ? { maxIterations: update.maxIterations } : {}),
    ...(update.stallCount !== undefined ? { stallCount: update.stallCount } : {}),
    ...(update.pauseReason !== undefined ? { pauseReason: update.pauseReason } : {}),
  }

  if (update.status === "active" && existing.status !== "active") {
    updated.lastStartedAt = now
  }

  if (update.status === "complete" && existing.status !== "complete") {
    updated.completedAt = now
  }

  writeGoal(ref, updated)
  return updated
}

function parseGoalFile(raw: string): GoalFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: STORE_VERSION, goal: null }
  }

  const result = GoalFileSchema.safeParse(parsed)
  if (!result.success) {
    return { version: STORE_VERSION, goal: null }
  }

  return result.data
}

function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string"
}

function nowSeconds(): number {
  return Math.trunc(Date.now() / 1000)
}
