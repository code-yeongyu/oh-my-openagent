import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import type { TaskObject } from "./types"
import { createTaskGetTool } from "./task-get"

const TEST_STORAGE = ".test-task-get-tool"
const TEST_DIR = join(process.cwd(), TEST_STORAGE)
const TEST_CONFIG = {
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
    },
  },
}
const TEST_SESSION_ID = "test-session-123"
const TEST_ABORT_CONTROLLER = new AbortController()
const TEST_CONTEXT = {
  sessionID: TEST_SESSION_ID,
  messageID: "test-message-123",
  agent: "test-agent",
  abort: TEST_ABORT_CONTROLLER.signal,
}

describe("task_get tool", () => {
  let tool: ReturnType<typeof createTaskGetTool>

  beforeEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    tool = createTaskGetTool(TEST_CONFIG)
  })

  afterEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
  })

  describe("get action", () => {
    test("retrieves existing task by ID", async () => {
      //#given
      const taskId = "T-test-123"
      const taskData: TaskObject = {
        id: taskId,
        subject: "Test task",
        description: "Test description",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: TEST_SESSION_ID,
      }
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      writeFileSync(taskFile, JSON.stringify(taskData, null, 2))

      //#when
      const resultStr = await tool.execute({ id: taskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("task")
      expect(result.task).not.toBeNull()
      expect(result.task.id).toBe(taskId)
      expect(result.task.subject).toBe("Test task")
      expect(result.task.description).toBe("Test description")
    })

    test("returns null for non-existent task", async () => {
      //#given
      const taskId = "T-nonexistent-999"

      //#when
      const resultStr = await tool.execute({ id: taskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("task")
      expect(result.task).toBeNull()
    })

    test("returns full task object with all fields", async () => {
      //#given
      const taskId = "T-full-task-456"
      const taskData: TaskObject = {
        id: taskId,
        subject: "Complex task",
        description: "Full description",
        status: "in_progress",
        activeForm: "Working on complex task",
        blocks: ["T-blocked-1", "T-blocked-2"],
        blockedBy: ["T-blocker-1"],
        owner: "test-agent",
        metadata: { priority: "high", tags: ["urgent", "backend"] },
        repoURL: "https://github.com/example/repo",
        parentID: "T-parent-123",
        threadID: TEST_SESSION_ID,
      }
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      writeFileSync(taskFile, JSON.stringify(taskData, null, 2))

      //#when
      const resultStr = await tool.execute({ id: taskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).toEqual(taskData)
      expect(result.task.blocks).toEqual(["T-blocked-1", "T-blocked-2"])
      expect(result.task.blockedBy).toEqual(["T-blocker-1"])
      expect(result.task.metadata).toEqual({ priority: "high", tags: ["urgent", "backend"] })
    })

    test("rejects invalid task ID format", async () => {
      //#given
      const invalidTaskId = "invalid-id-format"

      //#when
      const resultStr = await tool.execute({ id: invalidTaskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
      expect(result.error).toBe("invalid_task_id")
    })

    test("returns null for malformed task file", async () => {
      //#given
      const taskId = "T-malformed-789"
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      writeFileSync(taskFile, "{ invalid json }")

      //#when
      const resultStr = await tool.execute({ id: taskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).toBeNull()
    })

    test("returns null for task file with invalid schema", async () => {
      //#given
      const taskId = "T-invalid-schema-101"
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const invalidData = {
        id: taskId,
        subject: "Missing required fields",
        // Missing description and threadID
      }
      writeFileSync(taskFile, JSON.stringify(invalidData, null, 2))

      //#when
      const resultStr = await tool.execute({ id: taskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).toBeNull()
    })

    test("requires id parameter", async () => {
      //#given
      const args = {}

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
    })

    test("handles task with empty blocks and blockedBy arrays", async () => {
      //#given
      const taskId = "T-empty-arrays-202"
      const taskData: TaskObject = {
        id: taskId,
        subject: "Task with empty arrays",
        description: "Test",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: TEST_SESSION_ID,
      }
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      writeFileSync(taskFile, JSON.stringify(taskData, null, 2))

      //#when
      const resultStr = await tool.execute({ id: taskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.blocks).toEqual([])
      expect(result.task.blockedBy).toEqual([])
    })

    test("handles task with optional fields omitted", async () => {
      //#given
      const taskId = "T-minimal-303"
      const taskData: TaskObject = {
        id: taskId,
        subject: "Minimal task",
        description: "Minimal",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: TEST_SESSION_ID,
      }
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      writeFileSync(taskFile, JSON.stringify(taskData, null, 2))

      //#when
      const resultStr = await tool.execute({ id: taskId }, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).not.toBeNull()
      expect(result.task.id).toBe(taskId)
      expect(result.task.owner).toBeUndefined()
      expect(result.task.metadata).toBeUndefined()
    })
  })
})
