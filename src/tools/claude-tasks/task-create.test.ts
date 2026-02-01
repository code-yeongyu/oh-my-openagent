import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { createTaskCreate } from "./task-create"
import type { OhMyOpenCodeConfig } from "../../config/schema"

const TEST_TEAM = "test-team"
const TEST_STORAGE = ".test-claude-tasks-create"
const TEST_DIR = join(process.cwd(), TEST_STORAGE, TEST_TEAM)

const mockConfig: Partial<OhMyOpenCodeConfig> = {
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
    },
  },
}

describe("TaskCreate", () => {
  let taskCreate: ReturnType<typeof createTaskCreate>

  beforeEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
    taskCreate = createTaskCreate(mockConfig, TEST_TEAM)
  })

  afterEach(() => {
    const storageRoot = join(process.cwd(), TEST_STORAGE)
    if (existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  })

  test("creates task with required fields", async () => {
    //#given
    const args = {
      subject: "Run tests",
      description: "Execute test suite",
    }

    //#when
    const resultStr = await taskCreate.execute(args, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result).toHaveProperty("task")
    expect(result.task).toHaveProperty("id")
    expect(result.task.subject).toBe("Run tests")
  })

  test("creates task with activeForm", async () => {
    //#given
    const args = {
      subject: "Deploy app",
      description: "Deploy to production",
      activeForm: "Deploying app",
    }

    //#when
    const resultStr = await taskCreate.execute(args, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.task.id).toBeDefined()
    expect(result.task.subject).toBe("Deploy app")
  })

  test("creates task with metadata", async () => {
    //#given
    const args = {
      subject: "Fix bug",
      description: "Fix critical bug",
      metadata: { priority: "high", tags: ["urgent"] },
    }

    //#when
    const resultStr = await taskCreate.execute(args, {} as any)
    const result = JSON.parse(resultStr)

    //#then
    expect(result.task.id).toBeDefined()
    expect(result.task.subject).toBe("Fix bug")
  })

  test("generates sequential IDs", async () => {
    //#given
    const args1 = { subject: "Task 1", description: "First task" }
    const args2 = { subject: "Task 2", description: "Second task" }

    //#when
    const result1Str = await taskCreate.execute(args1, {} as any)
    const result2Str = await taskCreate.execute(args2, {} as any)
    const result1 = JSON.parse(result1Str)
    const result2 = JSON.parse(result2Str)

    //#then
    expect(result1.task.id).toBe("1")
    expect(result2.task.id).toBe("2")
  })

  test("requires subject field", async () => {
    //#given
    const args = {
      description: "Missing subject",
    } as any

    //#when
    const promise = taskCreate.execute(args, {} as any)

    //#then
    await expect(promise).rejects.toThrow()
  })

  test("requires description field", async () => {
    //#given
    const args = {
      subject: "Missing description",
    } as any

    //#when
    const promise = taskCreate.execute(args, {} as any)

    //#then
    await expect(promise).rejects.toThrow()
  })

  test("creates task file in correct location", async () => {
    //#given
    const args = {
      subject: "Test task",
      description: "Test description",
    }

    //#when
    await taskCreate.execute(args, {} as any)

    //#then
    const taskPath = join(TEST_DIR, "1.json")
    expect(existsSync(taskPath)).toBe(true)
  })
})
