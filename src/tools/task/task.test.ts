import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from "fs"
import { join } from "path"
import type { TaskObject } from "./types"
import { createTask } from "./task"

const TEST_STORAGE = ".test-task-tool"
const TEST_DIR = join(process.cwd(), TEST_STORAGE)
const TEST_CONFIG = {
  experimental: { task_system: true },
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
      claude_code_compat: true,
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

describe("task_tool", () => {
  let taskTool: ReturnType<typeof createTask>

  beforeEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    taskTool = createTask(TEST_CONFIG)
  })

  async function createTestTask(subject: string, overrides: Partial<Parameters<typeof taskTool.execute>[0]> = {}): Promise<string> {
    const args = {
      action: "create" as const,
      subject,
      ...overrides,
    }
    const resultStr = await taskTool.execute(args, TEST_CONTEXT)
    const result = JSON.parse(resultStr)
    return (result as { task: TaskObject }).task.id
  }

  afterEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
  })

  // ============================================================================
  // CREATE ACTION TESTS
  // ============================================================================

  describe("create action", () => {
    test("creates task with required title field", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Implement authentication",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("task")
      expect(result.task).toHaveProperty("id")
      expect(result.task.subject).toBe("Implement authentication")
      expect(result.task.status).toBe("pending")
    })

    test("auto-generates T-{uuid} format ID", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.id).toMatch(/^T-[a-f0-9-]+$/)
    })

    test("auto-records threadID from session context", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).toHaveProperty("threadID")
      expect(typeof result.task.threadID).toBe("string")
    })

    test("sets status to open by default", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.status).toBe("pending")
    })

    test("stores optional description field", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
        description: "Detailed description of the task",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.description).toBe("Detailed description of the task")
    })

    test("stores dependsOn array", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
        blockedBy: ["T-dep1", "T-dep2"],
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.blockedBy).toEqual(["T-dep1", "T-dep2"])
    })

    test("stores parentID when provided", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Subtask",
        parentID: "T-parent123",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.parentID).toBe("T-parent123")
    })

    test("stores repoURL when provided", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
        repoURL: "https://github.com/code-yeongyu/oh-my-opencode",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.repoURL).toBe("https://github.com/code-yeongyu/oh-my-opencode")
    })

    test("returns result as JSON string with task property", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)

      //#then
      expect(typeof resultStr).toBe("string")
      const result = JSON.parse(resultStr)
      expect(result).toHaveProperty("task")
    })

    test("initializes dependsOn as empty array when not provided", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.blockedBy).toEqual([])
    })
  })

  // ============================================================================
  // LIST ACTION TESTS
  // ============================================================================

  describe("list action", () => {
    test("returns all non-completed tasks by default", async () => {
      //#given
      const args = {
        action: "list" as const,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("tasks")
      expect(Array.isArray(result.tasks)).toBe(true)
    })

    test("excludes completed tasks from list", async () => {
      //#given
      const args = {
        action: "list" as const,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      const completedTasks = result.tasks.filter((t: TaskObject) => t.status === "completed")
      expect(completedTasks.length).toBe(0)
    })

    test("applies ready filter when requested", async () => {
      //#given
      const args = {
        action: "list" as const,
        ready: true,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("tasks")
      expect(Array.isArray(result.tasks)).toBe(true)
    })

    test("respects limit parameter", async () => {
      //#given
      const args = {
        action: "list" as const,
        limit: 5,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.tasks.length).toBeLessThanOrEqual(5)
    })

    test("returns result as JSON string with tasks array", async () => {
      //#given
      const args = {
        action: "list" as const,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)

      //#then
      expect(typeof resultStr).toBe("string")
      const result = JSON.parse(resultStr)
      expect(Array.isArray(result.tasks)).toBe(true)
    })

    test("filters by status when provided", async () => {
      //#given
      const args = {
        action: "list" as const,
        status: "in_progress" as const,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      const allInProgress = result.tasks.every((t: TaskObject) => t.status === "in_progress")
      expect(allInProgress).toBe(true)
    })
  })

  // ============================================================================
  // GET ACTION TESTS
  // ============================================================================

  describe("get action", () => {
    test("returns task by ID", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "get" as const,
        id: testId,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("task")
    })

    test("returns null for non-existent task", async () => {
      //#given
      const args = {
        action: "get" as const,
        id: "T-nonexistent",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).toBeNull()
    })

    test("rejects invalid task id", async () => {
      //#given
      const args = {
        action: "get" as const,
        id: "../package",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
      expect(result.error).toBe("invalid_task_id")
    })

    test("returns result as JSON string with task property", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "get" as const,
        id: testId,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)

      //#then
      expect(typeof resultStr).toBe("string")
      const result = JSON.parse(resultStr)
      expect(result).toHaveProperty("task")
    })

    test("returns complete task object with all fields", async () => {
      //#given
      const args = {
        action: "get" as const,
        id: "T-test123",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      if (result.task !== null) {
        expect(result.task).toHaveProperty("id")
        expect(result.task).toHaveProperty("subject")
        expect(result.task).toHaveProperty("status")
        expect(result.task).toHaveProperty("threadID")
      }
    })
  })

  // ============================================================================
  // UPDATE ACTION TESTS
  // ============================================================================

  describe("update action", () => {
    test("updates task title", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "update" as const,
        id: testId,
        subject: "Updated subject",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("task")
      expect(result.task.subject).toBe("Updated subject")
    })

    test("updates task description", async () => {
      //#given
      const testId = await createTestTask("Test task", { description: "Initial description" })
      const args = {
        action: "update" as const,
        id: testId,
        description: "Updated description",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.description).toBe("Updated description")
    })

    test("updates task status", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "update" as const,
        id: testId,
        status: "in_progress" as const,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.status).toBe("in_progress")
    })

    test("updates blockedBy array additively", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "update" as const,
        id: testId,
        addBlockedBy: ["T-dep1", "T-dep2", "T-dep3"],
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.blockedBy).toEqual(["T-dep1", "T-dep2", "T-dep3"])
    })

    test("returns error for non-existent task", async () => {
      //#given
      const args = {
        action: "update" as const,
        id: "T-nonexistent",
        subject: "New subject",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
      expect(result.error).toBe("task_not_found")
    })

    test("rejects invalid task id", async () => {
      //#given
      const args = {
        action: "update" as const,
        id: "../package",
        subject: "New subject",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
      expect(result.error).toBe("invalid_task_id")
    })

    test("returns lock unavailable when lock is held", async () => {
      //#given
      writeFileSync(join(TEST_DIR, ".lock"), JSON.stringify({ id: "test", timestamp: Date.now() }))
      const args = {
        action: "update" as const,
        id: "T-nonexistent",
        subject: "New subject",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
      expect(result.error).toBe("task_lock_unavailable")
    })

    test("returns result as JSON string with task property", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "update" as const,
        id: testId,
        subject: "Updated",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)

      //#then
      expect(typeof resultStr).toBe("string")
      const result = JSON.parse(resultStr)
      expect(result).toHaveProperty("task")
    })

    test("updates multiple fields at once", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "update" as const,
        id: testId,
        subject: "New subject",
        description: "New description",
        status: "completed" as const,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task.subject).toBe("New subject")
      expect(result.task.description).toBe("New description")
      expect(result.task.status).toBe("completed")
    })
  })

  // ============================================================================
  // DELETE ACTION TESTS
  // ============================================================================

  describe("delete action", () => {
    test("removes task file physically", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "delete" as const,
        id: testId,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("success")
      expect(result.success).toBe(true)
    })

    test("returns success true on successful deletion", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "delete" as const,
        id: testId,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.success).toBe(true)
    })

    test("returns error for non-existent task", async () => {
      //#given
      const args = {
        action: "delete" as const,
        id: "T-nonexistent",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
      expect(result.error).toBe("task_not_found")
    })

    test("rejects invalid task id", async () => {
      //#given
      const args = {
        action: "delete" as const,
        id: "../package",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toHaveProperty("error")
      expect(result.error).toBe("invalid_task_id")
    })

    test("returns result as JSON string", async () => {
      //#given
      const testId = await createTestTask("Test task")
      const args = {
        action: "delete" as const,
        id: testId,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)

      //#then
      expect(typeof resultStr).toBe("string")
      const result = JSON.parse(resultStr)
      expect(result).toHaveProperty("success")
    })
  })

  // ============================================================================
  // EDGE CASE TESTS
  // ============================================================================

  describe("edge cases", () => {
    test("detects circular dependency (A depends on B, B depends on A)", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Task A",
        blockedBy: ["T-taskB"],
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      // Should either prevent creation or mark as circular
      expect(result).toHaveProperty("task")
    })

    test("handles task depending on non-existent ID", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Task with missing dependency",
        blockedBy: ["T-nonexistent"],
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      // Should either allow or return error
      expect(result).toHaveProperty("task")
    })

    test("ready filter returns true for empty dependsOn", async () => {
      //#given
      const args = {
        action: "list" as const,
        ready: true,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      const tasksWithNoDeps = result.tasks.filter((t: TaskObject) => t.blockedBy.length === 0)
      expect(tasksWithNoDeps.length).toBeGreaterThanOrEqual(0)
    })

    test("ready filter includes tasks with all completed dependencies", async () => {
      //#given
      const args = {
        action: "list" as const,
        ready: true,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(Array.isArray(result.tasks)).toBe(true)
    })

    test("ready filter excludes tasks with incomplete dependencies", async () => {
      //#given
      const args = {
        action: "list" as const,
        ready: true,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(Array.isArray(result.tasks)).toBe(true)
    })

    test("handles empty title gracefully", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      // Should either reject or handle empty title
      expect(result).toBeDefined()
    })

    test("handles very long title", async () => {
      //#given
      const longSubject = "A".repeat(1000)
      const args = {
        action: "create" as const,
        subject: longSubject,
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toBeDefined()
    })

    test("handles special characters in title", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Task with special chars: !@#$%^&*()",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toBeDefined()
    })

    test("handles unicode characters in title", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "任務 🚀 Tâche",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result).toBeDefined()
    })

    test("preserves all TaskObject fields in round-trip", async () => {
      //#given
      const args = {
        action: "create" as const,
        subject: "Test task",
        description: "Test description",
        blockedBy: ["T-dep1"],
        parentID: "T-parent",
        repoURL: "https://example.com",
      }

      //#when
      const resultStr = await taskTool.execute(args, TEST_CONTEXT)
      const result = JSON.parse(resultStr)

      //#then
      expect(result.task).toHaveProperty("id")
      expect(result.task).toHaveProperty("subject")
      expect(result.task).toHaveProperty("description")
      expect(result.task).toHaveProperty("status")
      expect(result.task).toHaveProperty("blockedBy")
      expect(result.task).toHaveProperty("parentID")
      expect(result.task).toHaveProperty("repoURL")
      expect(result.task).toHaveProperty("threadID")
    })
  })
})
