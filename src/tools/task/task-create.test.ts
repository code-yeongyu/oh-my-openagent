import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import type { TaskObject } from "./types"
import { createTaskCreateTool } from "./task-create"

const TEST_STORAGE = ".test-task-create-tool"
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

describe("task_create tool", () => {
  let tool: ReturnType<typeof createTaskCreateTool>

  beforeEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    tool = createTaskCreateTool(TEST_CONFIG)
  })

  afterEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
  })

  describe("create action", () => {
    test("creates task with required subject field", async () => {
      //#given
      const args = {
        subject: "Implement authentication",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("task")
      expect(result.task).toHaveProperty("id")
      expect(result.task.subject).toBe("Implement authentication")
    })

    test("auto-generates T-{uuid} format ID", async () => {
      //#given
      const args = {
        subject: "Test task",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.id).toMatch(/^T-[a-f0-9-]+$/)
    })

    test("auto-records threadID from session context", async () => {
      //#given
      const args = {
        subject: "Test task",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      expect(existsSync(taskFile)).toBe(true)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.threadID).toBe(TEST_SESSION_ID)
    })

    test("sets default status to pending", async () => {
      //#given
      const args = {
        subject: "Test task",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.status).toBe("pending")
    })

    test("sets default blocks and blockedBy to empty arrays", async () => {
      //#given
      const args = {
        subject: "Test task",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.blocks).toEqual([])
      expect(taskContent.blockedBy).toEqual([])
    })

    test("accepts optional description", async () => {
      //#given
      const args = {
        subject: "Test task",
        description: "This is a test description",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.description).toBe("This is a test description")
    })

    test("accepts optional activeForm", async () => {
      //#given
      const args = {
        subject: "Test task",
        activeForm: "Implementing authentication",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.activeForm).toBe("Implementing authentication")
    })

    test("accepts optional metadata", async () => {
      //#given
      const args = {
        subject: "Test task",
        metadata: { priority: "high", tags: ["urgent"] },
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.metadata).toEqual({ priority: "high", tags: ["urgent"] })
    })

    test("accepts optional blockedBy array", async () => {
      //#given
      const args = {
        subject: "Test task",
        blockedBy: ["T-123", "T-456"],
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.blockedBy).toEqual(["T-123", "T-456"])
    })

    test("accepts optional blocks array", async () => {
      //#given
      const args = {
        subject: "Test task",
        blocks: ["T-789", "T-101"],
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.blocks).toEqual(["T-789", "T-101"])
    })

    test("accepts optional repoURL", async () => {
      //#given
      const args = {
        subject: "Test task",
        repoURL: "https://github.com/example/repo",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.repoURL).toBe("https://github.com/example/repo")
    })

    test("accepts optional parentID", async () => {
      //#given
      const args = {
        subject: "Test task",
        parentID: "T-parent-123",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.parentID).toBe("T-parent-123")
    })

    test("returns minimal response with id and subject", async () => {
      //#given
      const args = {
        subject: "Test task",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).toHaveProperty("id")
      expect(result.task).toHaveProperty("subject")
      expect(result.task.subject).toBe("Test task")
    })

    test("rejects missing subject", async () => {
      //#given
      const args = {}

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
    })

    test("writes task to file storage atomically", async () => {
      //#given
      const args = {
        subject: "Test task",
        description: "Test description",
      }

      //#when
      const resultStr = await tool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)
      const taskId = result.task.id

      //#then
      const taskFile = join(TEST_DIR, `${taskId}.json`)
      expect(existsSync(taskFile)).toBe(true)
      const taskContent = JSON.parse(await Bun.file(taskFile).text())
      expect(taskContent.id).toBe(taskId)
      expect(taskContent.subject).toBe("Test task")
      expect(taskContent.description).toBe("Test description")
    })

    describe("near-duplicate detection", () => {
      test("same subject + same session → warning", async () => {
        //#given
        const args1 = { subject: "Fix login bug" }
        const args2 = { subject: "Fix login bug" }
        const context1 = { ...TEST_CONTEXT, sessionID: "ses_test" }

        //#when
        const result1Str = await tool.execute(args1, context1)
        const result1 = JSON.parse(result1Str)
        const result2Str = await tool.execute(args2, context1)
        const result2 = JSON.parse(result2Str)

        //#then
        expect(result1).not.toHaveProperty("warning")
        expect(result2).toHaveProperty("warning")
        expect(result2.warning).toContain(result1.task.id)
        expect(result2.warning).toContain("pending")
      })

      test("same subject + different session → no warning", async () => {
        //#given
        const args = { subject: "Fix login bug" }
        const contextA = { ...TEST_CONTEXT, sessionID: "ses_A" }
        const contextB = { ...TEST_CONTEXT, sessionID: "ses_B" }

        //#when
        await tool.execute(args, contextA)
        const result2Str = await tool.execute(args, contextB)
        const result2 = JSON.parse(result2Str)

        //#then
        expect(result2).not.toHaveProperty("warning")
      })

      test("different subject → no warning", async () => {
        //#given
        const args1 = { subject: "Fix login bug" }
        const args2 = { subject: "Fix signup bug" }
        const context = { ...TEST_CONTEXT, sessionID: "ses_test" }

        //#when
        await tool.execute(args1, context)
        const result2Str = await tool.execute(args2, context)
        const result2 = JSON.parse(result2Str)

        //#then
        expect(result2).not.toHaveProperty("warning")
      })

      test("task still created even with warning", async () => {
        //#given
        const args = { subject: "Fix login bug" }
        const context = { ...TEST_CONTEXT, sessionID: "ses_test" }

        //#when
        const result1Str = await tool.execute(args, context)
        const result1 = JSON.parse(result1Str)
        const result2Str = await tool.execute(args, context)
        const result2 = JSON.parse(result2Str)

        //#then
        expect(result2).toHaveProperty("task")
        expect(result2.task).toHaveProperty("id")
        expect(result2.task.id).not.toBe(result1.task.id)

        // Both files should exist
        const task1File = join(TEST_DIR, `${result1.task.id}.json`)
        const task2File = join(TEST_DIR, `${result2.task.id}.json`)
        expect(existsSync(task1File)).toBe(true)
        expect(existsSync(task2File)).toBe(true)
      })
    })
  })
})
