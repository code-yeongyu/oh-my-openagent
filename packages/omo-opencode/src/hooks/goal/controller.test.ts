import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGoalController } from "./controller"

function makeController() {
  const projectDir = mkdtempSync(join(tmpdir(), "goal-ctrl-"))
  return {
    controller: createGoalController({ projectDir }),
    projectDir,
    mirrorPath: (sessionID: string) =>
      join(projectDir, ".omo", "ulw-loop", sessionID, "goals.json"),
  }
}

describe("createGoalController", () => {
  test("setGoal creates active goal and mirror", () => {
    const { controller, mirrorPath } = makeController()

    const goal = controller.setGoal("s1", "Ship feature")

    expect(goal.objective).toBe("Ship feature")
    expect(goal.status).toBe("active")
    const mirror = JSON.parse(readFileSync(mirrorPath("s1"), "utf-8"))
    expect(mirror.activeGoalId).toBe(goal.id)
    expect(mirror.goals[0].status).toBe("in_progress")
  })

  test("setGoal replaces existing goal", () => {
    const { controller } = makeController()
    controller.setGoal("s1", "First")

    const goal = controller.setGoal("s1", "Second")

    expect(goal.objective).toBe("Second")
    expect(controller.getGoal("s1")?.objective).toBe("Second")
  })

  test("setGoal trims objective", () => {
    const { controller } = makeController()
    const goal = controller.setGoal("s1", "  Trimmed  ")
    expect(goal.objective).toBe("Trimmed")
  })

  test("pause and resume toggle status", () => {
    const { controller } = makeController()
    controller.setGoal("s1", "Work")

    const paused = controller.pauseGoal("s1")
    expect(paused?.status).toBe("paused")

    const resumed = controller.resumeGoal("s1")
    expect(resumed?.status).toBe("active")
  })

  test("markComplete sets complete and timestamp", () => {
    const { controller } = makeController()
    controller.setGoal("s1", "Work")

    const completed = controller.markComplete("s1")

    expect(completed?.status).toBe("complete")
    expect(completed?.completedAt).toBeGreaterThan(0)
  })

  test("clearGoal removes goal and empties mirror", () => {
    const { controller, mirrorPath } = makeController()
    controller.setGoal("s1", "Work")

    const existed = controller.clearGoal("s1")

    expect(existed).toBe(true)
    expect(controller.getGoal("s1")).toBeNull()
    const mirror = JSON.parse(readFileSync(mirrorPath("s1"), "utf-8"))
    expect(mirror.goals).toEqual([])
  })

  test("accountUsage updates active goal", () => {
    const { controller } = makeController()
    controller.setGoal("s1", "Work")

    const updated = controller.accountUsage("s1", {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
    }, 5)

    expect(updated?.tokensUsed).toBe(30)
    expect(updated?.timeUsedSeconds).toBe(5)
  })

  test("accountUsage ignores non-active goal", () => {
    const { controller } = makeController()
    controller.setGoal("s1", "Work")
    controller.pauseGoal("s1")

    const updated = controller.accountUsage("s1", {
      input: 10,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10,
    }, 1)

    expect(updated?.tokensUsed).toBe(0)
  })

  test("getGoal returns null when absent", () => {
    const { controller } = makeController()
    expect(controller.getGoal("missing")).toBeNull()
  })
})
