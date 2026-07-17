import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GoalFileSchema, type Goal, type GoalFile, type GoalStoreRef, type GoalUpdate } from "./types"

const STORE_VERSION = 1

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
  return parsed.goal
}

export function writeGoal(ref: GoalStoreRef, goal: Goal | null): void {
  ensureGoalStoreDir(ref.baseDir)
  const filePath = goalFilePath(ref)
  const tempPath = `${filePath}.tmp.${randomUUID()}`
  const file: GoalFile = { version: STORE_VERSION, goal }
  writeFileSync(tempPath, JSON.stringify(file, null, 2), "utf-8")
  renameSync(tempPath, filePath)
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
    objective: objective.trim(),
    status: "active",
    tokensUsed: 0,
    timeUsedSeconds: 0,
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
    updatedAt: now,
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
