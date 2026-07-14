import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("kanban", () => {
  const TEST_ROOT = join(tmpdir(), `matrix-kanban-test-${process.pid}-${Date.now()}`)
  const TEST_LOG = join(TEST_ROOT, "kanban.jsonl")
  const TEST_DASH = join(TEST_ROOT, "kanban.html")

  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true })
    mkdirSync(TEST_ROOT, { recursive: true })
    process.chdir(TEST_ROOT)
  })

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true })
  })

  test("createTask creates a new task in queued state", async () => {
    const { createTask, readTasks } = await import("./kanban")
    const task = createTask({
      title: "Test task",
      agent: "morpheus",
      priority: "medium",
    })
    expect(task.state).toBe("queued")
    expect(task.title).toBe("Test task")
    expect(task.priority).toBe("medium")
    const all = readTasks()
    expect(all.find(t => t.id === task.id)).toBeDefined()
  })

  test("transitionTask moves between states", async () => {
    const { createTask, transitionTask, getTask } = await import("./kanban")
    const task = createTask({ title: "T", agent: "tank", priority: "high" })
    transitionTask(task.id, "in-progress")
    let t = getTask(task.id)
    expect(t?.state).toBe("in-progress")
    transitionTask(task.id, "done")
    t = getTask(task.id)
    expect(t?.state).toBe("done")
    expect(t?.completedAt).toBeDefined()
  })

  test("transitionTask records errors", async () => {
    const { createTask, transitionTask, getTask } = await import("./kanban")
    const task = createTask({ title: "T", agent: "tank", priority: "low" })
    transitionTask(task.id, "failed", { error: "compilation failed" })
    const t = getTask(task.id)
    expect(t?.state).toBe("failed")
    expect(t?.lastError).toBe("compilation failed")
  })

  test("computeStats returns aggregate counts", async () => {
    const { createTask, transitionTask, computeStats } = await import("./kanban")
    const t1 = createTask({ title: "T1", agent: "morpheus", priority: "critical" })
    const t2 = createTask({ title: "T2", agent: "tank", priority: "medium" })
    const t3 = createTask({ title: "T3", agent: "morpheus", priority: "high" })
    transitionTask(t1.id, "done")
    transitionTask(t2.id, "in-progress")
    transitionTask(t3.id, "blocked")
    const stats = computeStats()
    expect(stats.totalTasks).toBe(3)
    expect(stats.byState.done).toBe(1)
    expect(stats.byState["in-progress"]).toBe(1)
    expect(stats.byState.blocked).toBe(1)
    expect(stats.byAgent.morpheus.count).toBe(2)
    expect(stats.byAgent.tank.count).toBe(1)
    expect(stats.blockedTasks.length).toBe(1)
  })
})
