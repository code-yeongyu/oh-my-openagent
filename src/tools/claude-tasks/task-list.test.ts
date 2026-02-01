import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { createTaskList } from "./task-list"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { Task } from "../../features/claude-tasks/types"

const TEST_TEAM = "test-team"
const TEST_STORAGE = ".test-claude-tasks-list"
const TEST_DIR = join(process.cwd(), TEST_STORAGE, TEST_TEAM)

const mockConfig: Partial<OhMyOpenCodeConfig> = {
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
    },
  },
}

describe("TaskList", () => {
  let taskList: ReturnType<typeof createTaskList>

  beforeEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    taskList = createTaskList(mockConfig, TEST_TEAM)
  })

  afterEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  })

  test("returns empty array when no tasks exist", async () => {
    //#given
    //#when
    const resultStr = await taskList.execute({}, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.tasks).toEqual([])
  })

  test("lists all tasks with summary fields", async () => {
    //#given
    const task1: Task = {
      id: "1",
      subject: "Task 1",
      description: "Description 1",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    const task2: Task = {
      id: "2",
      subject: "Task 2",
      description: "Description 2",
      status: "in_progress",
      owner: "sisyphus",
      blocks: [],
      blockedBy: ["1"],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task1, null, 2))
    writeFileSync(join(TEST_DIR, "2.json"), JSON.stringify(task2, null, 2))

    //#when
    const resultStr = await taskList.execute({}, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]).toHaveProperty("id")
    expect(result.tasks[0]).toHaveProperty("subject")
    expect(result.tasks[0]).toHaveProperty("status")
    expect(result.tasks[0]).toHaveProperty("blockedBy")
  })

  test("includes owner field when present", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Task with owner",
      description: "Test",
      status: "in_progress",
      owner: "sisyphus",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskList.execute({}, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.tasks[0].owner).toBe("sisyphus")
  })

  test("omits owner field when not present", async () => {
    //#given
    const task: Task = {
      id: "1",
      subject: "Task without owner",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task, null, 2))

    //#when
    const resultStr = await taskList.execute({}, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.tasks[0].owner).toBeUndefined()
  })

  test("returns tasks sorted by ID", async () => {
    //#given
    const task3: Task = {
      id: "3",
      subject: "Task 3",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    const task1: Task = {
      id: "1",
      subject: "Task 1",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    const task2: Task = {
      id: "2",
      subject: "Task 2",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "3.json"), JSON.stringify(task3, null, 2))
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task1, null, 2))
    writeFileSync(join(TEST_DIR, "2.json"), JSON.stringify(task2, null, 2))

    //#when
    const resultStr = await taskList.execute({}, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.tasks.map((t) => t.id)).toEqual(["1", "2", "3"])
  })

  test("excludes deleted tasks", async () => {
    //#given
    const task1: Task = {
      id: "1",
      subject: "Active task",
      description: "Test",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }
    const task2: Task = {
      id: "2",
      subject: "Deleted task",
      description: "Test",
      status: "deleted",
      blocks: [],
      blockedBy: [],
    }
    writeFileSync(join(TEST_DIR, "1.json"), JSON.stringify(task1, null, 2))
    writeFileSync(join(TEST_DIR, "2.json"), JSON.stringify(task2, null, 2))

    //#when
    const resultStr = await taskList.execute({}, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].id).toBe("1")
  })
})
