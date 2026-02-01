import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from "fs"
import { join } from "path"
import { createTaskUpdate } from "./task-update"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { Task } from "../../features/claude-tasks/types"

const TEST_TEAM = "test-team"
const TEST_STORAGE = ".test-claude-tasks-update"
const TEST_DIR = join(process.cwd(), TEST_STORAGE, TEST_TEAM)

const mockConfig: Partial<OhMyOpenCodeConfig> = {
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
    },
  },
}

describe("TaskUpdate", () => {
  let taskUpdate: ReturnType<typeof createTaskUpdate>

  beforeEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    taskUpdate = createTaskUpdate(mockConfig, TEST_TEAM)
  })

  afterEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  })

  test("updates task subject", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Old subject",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskUpdate.execute({ taskId: "1", subject: "New subject" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(true)
    expect(result.updatedFields).toContain("subject")
  })

  test("updates task status", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Test",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskUpdate.execute({ taskId: "1", status: "in_progress" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(true)
    expect(result.statusChange).toEqual({ from: "pending", to: "in_progress" })
  })

  test("adds blocks dependencies", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Test",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskUpdate.execute({ taskId: "1", addBlocks: ["2", "3"] }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(true)
    expect(result.updatedFields).toContain("blocks")
  })

  test("adds blockedBy dependencies", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Test",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskUpdate.execute({ taskId: "1", addBlockedBy: ["2"] }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(true)
    expect(result.updatedFields).toContain("blockedBy")
  })

  test("returns error when task not found", async () => {
    //#given
    //#when
    const resultStr = await taskUpdate.execute({ taskId: "999", subject: "New" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(false)
    expect(result.error).toBe("task_not_found")
  })

  test("returns error when task already completed", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Test",
      description: "Test",
      status: "completed",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskUpdate.execute({ taskId: "1", status: "in_progress" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(false)
    expect(result.error).toBe("already_resolved")
  })

  test("returns error when task is blocked", async () => {
    //#given
    const blocker: Task = {
      id: "1",
      subject: "Blocker",
      description: "Blocker task",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
    }
    const blocked: Task = {
      id: "2",
      subject: "Blocked",
      description: "Blocked task",
      status: "pending",
      blocks: [],
      blockedBy: ["1"],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(blocker, null, 2))
    writeFileSync(join(TEST_DIR, "2.json"), JSON.stringify(blocked, null, 2))

    //#when
    const resultStr = await taskUpdate.execute({ taskId: "2", status: "in_progress" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(false)
    expect(result.error).toBe("blocked")
  })

  test("returns error when owner already has in_progress task", async () => {
    //#given
    const task1: Task = {
      id: "1",
      subject: "Task 1",
      description: "First task",
      status: "in_progress",
      owner: "sisyphus",
      blocks: [],
      blockedBy: [],
    }
    const task2: Task = {
      id: "2",
      subject: "Task 2",
      description: "Second task",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task1, null, 2))
    writeFileSync(join(TEST_DIR, "2.json"), JSON.stringify(task2, null, 2))

    //#when
    const resultStr = await taskUpdate.execute({ taskId: "2", status: "in_progress", owner: "sisyphus" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(false)
    expect(result.error).toBe("agent_busy")
  })

  test("updates multiple fields at once", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Old",
      description: "Old desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskUpdate.execute(
      {
        taskId: "1",
        subject: "New",
        description: "New desc",
        status: "in_progress",
        owner: "sisyphus",
      },
      {} as any
    )
    const result = JSON.parse(resultStr)

    //#then
    expect(result.success).toBe(true)
    expect(result.updatedFields).toContain("subject")
    expect(result.updatedFields).toContain("description")
    expect(result.updatedFields).toContain("status")
    expect(result.updatedFields).toContain("owner")
  })
})
