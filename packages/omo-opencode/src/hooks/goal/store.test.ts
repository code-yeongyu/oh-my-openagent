import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearGoal, createGoal, goalFilePath, readGoal, updateGoal, writeGoal } from "./store"
import type { GoalStoreRef } from "./types"

function createRef(): GoalStoreRef {
  const baseDir = mkdtempSync(join(tmpdir(), "goal-store-test-"))
  return { baseDir, sessionID: "ses_test_123" }
}

describe("goal store", () => {
  test("createGoal writes a versioned goal file", () => {
    const ref = createRef()

    const goal = createGoal(ref, "Ship the dashboard")

    expect(goal.objective).toBe("Ship the dashboard")
    expect(goal.status).toBe("active")
    expect(goal.sessionID).toBe(ref.sessionID)
    expect(goal.lastStartedAt).toBeGreaterThan(0)
    const raw = readFileSync(goalFilePath(ref), "utf-8")
    expect(raw).toContain('"version": 1')
    expect(raw).toContain('"Ship the dashboard"')
  })

  test("readGoal returns null when no file exists", () => {
    const ref = createRef()

    const result = readGoal(ref)

    expect(result).toBeNull()
  })

  test("readGoal returns null for malformed JSON", () => {
    const ref = createRef()
    writeGoal(ref, null)
    const filePath = goalFilePath(ref)
    readFileSync(filePath, "utf-8")
    // overwrite with invalid JSON
    writeFileSync(filePath, "not json")

    const result = readGoal(ref)

    expect(result).toBeNull()
  })

  test("updateGoal changes objective and status", () => {
    const ref = createRef()
    createGoal(ref, "Initial objective")

    const updated = updateGoal(ref, { objective: "Updated objective", status: "complete" })

    expect(updated?.objective).toBe("Updated objective")
    expect(updated?.status).toBe("complete")
    expect(updated?.completedAt).toBeGreaterThan(0)
  })

  test("updateGoal returns null when no goal exists", () => {
    const ref = createRef()

    const updated = updateGoal(ref, { status: "complete" })

    expect(updated).toBeNull()
  })

  test("clearGoal removes the file", () => {
    const ref = createRef()
    createGoal(ref, "To be cleared")

    const cleared = clearGoal(ref)

    expect(cleared).toBe(true)
    expect(readGoal(ref)).toBeNull()
  })

  test("writeGoal with null clears active goal", () => {
    const ref = createRef()
    createGoal(ref, "To be nulled")

    writeGoal(ref, null)

    expect(readGoal(ref)).toBeNull()
  })

  test("goal file survives a round trip", () => {
    const ref = createRef()
    const goal = createGoal(ref, "Round trip")

    const reRead = readGoal(ref)

    expect(reRead).toEqual(goal)
  })
})
