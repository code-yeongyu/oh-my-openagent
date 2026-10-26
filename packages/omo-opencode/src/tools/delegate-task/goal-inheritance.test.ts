import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGoalController } from "../../hooks/goal/controller"
import { inheritGoalToChild } from "./goal-inheritance"

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "goal-store-test-inherit-"))
}

describe("inheritGoalToChild", () => {
  test("given active parent goal, when inheriting, then child goal links to parent", () => {
    // given
    const dir = freshDir()
    const controller = createGoalController({ projectDir: dir })
    const parent = controller.setGoal("parent-1", "Ship the feature")
    // when
    const ok = inheritGoalToChild({ projectDir: dir, parentSessionID: "parent-1", childSessionID: "child-1" })
    // then
    expect(ok).toBe(true)
    const child = controller.getGoal("child-1")
    expect(child?.objective).toBe("Ship the feature")
    expect(child?.parentGoalID).toBe(parent.id)
    expect(child?.rootGoalID).toBe(parent.id)
    expect(controller.getGoal("parent-1")?.childSessionIDs).toContain("child-1")
  })
  test("given no parent goal, when inheriting, then returns false", () => {
    // given
    const dir = freshDir()
    // when
    const ok = inheritGoalToChild({ projectDir: dir, parentSessionID: "nobody", childSessionID: "child-2" })
    // then
    expect(ok).toBe(false)
  })
  test("given paused parent goal, when inheriting, then returns false", () => {
    // given
    const dir = freshDir()
    const controller = createGoalController({ projectDir: dir })
    controller.setGoal("parent-3", "Paused work")
    controller.pauseGoal("parent-3")
    // when
    const ok = inheritGoalToChild({ projectDir: dir, parentSessionID: "parent-3", childSessionID: "child-3" })
    // then
    expect(ok).toBe(false)
  })
})