import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { createTaskGet } from "./task-get"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { Task } from "../../features/claude-tasks/types"

const TEST_TEAM = "test-team"
const TEST_STORAGE = ".test-claude-tasks-get"
const TEST_DIR = join(process.cwd(), TEST_STORAGE, TEST_TEAM)

const mockConfig: Partial<OhMyOpenCodeConfig> = {
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
    },
  },
}

describe("TaskGet", () => {
  let taskGet: ReturnType<typeof createTaskGet>

  beforeEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    taskGet = createTaskGet(mockConfig, TEST_TEAM)
  })

  afterEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  })

  test("returns task when it exists", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Test task",
      description: "Test description",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskGet.execute({ taskId: "1" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.task).not.toBeNull()
    expect(result.task?.id).toBe("1")
    expect(result.task?.subject).toBe("Test task")
    expect(result.task?.status).toBe("pending")
  })

  test("returns null when task does not exist", async () => {
    //#given
    //#when
    const resultStr = await taskGet.execute({ taskId: "999" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.task).toBeNull()
  })

  test("returns all task fields including optional ones", async () => {
    //#given
    const task: Task = {
      id: "2",
      subject: "Complex task",
      description: "Detailed description",
      status: "in_progress",
      activeForm: "Working on task",
      blocks: ["3", "4"],
      blockedBy: ["1"],
      owner: "sisyphus",
      metadata: { priority: "high" },
    }
    writeFileSync(join(TEST_DIR, "2.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskGet.execute({ taskId: "2" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.task).not.toBeNull()
    expect(result.task?.activeForm).toBe("Working on task")
    expect(result.task?.blocks).toEqual(["3", "4"])
    expect(result.task?.blockedBy).toEqual(["1"])
    expect(result.task?.owner).toBe("sisyphus")
    expect(result.task?.metadata).toEqual({ priority: "high" })
  })

  test("handles missing task gracefully", async () => {
    //#given
    //#when
    const resultStr = await taskGet.execute({ taskId: "nonexistent" }, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.task).toBeNull()
  })
})
