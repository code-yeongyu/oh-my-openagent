import { describe, test, expect } from "bun:test"
import type { BackgroundTask } from "./types"
import {
  extractTaskResultData,
  compressTaskResult,
  compressTaskResults,
  formatCompressedNotification,
} from "./parent-session-notifier"

const DEFAULT_CONFIG = {
  enabled: true,
  threshold: 5000,
}

const DISABLED_CONFIG = {
  enabled: false,
  threshold: 5000,
}

function createMockTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_test123",
    parentSessionID: "parent_session",
    parentMessageID: "msg_001",
    description: "Test task",
    prompt: "Test prompt",
    agent: "explore",
    status: "completed",
    ...overrides,
  }
}

describe("extractTaskResultData", () => {
  describe("#given a completed task", () => {
    test("extracts basic task data", () => {
      const task = createMockTask({
        status: "completed",
        sessionID: "session_123",
        result: "Task completed successfully",
      })

      const data = extractTaskResultData(task)

      expect(data.taskId).toBe("bg_test123")
      expect(data.description).toBe("Test task")
      expect(data.status).toBe("completed")
      expect(data.sessionID).toBe("session_123")
      expect(data.result).toBe("Task completed successfully")
    })

    test("handles tasks with date fields", () => {
      const task = createMockTask({
        startedAt: new Date("2024-01-01T10:00:00Z"),
        completedAt: new Date("2024-01-01T10:05:00Z"),
      })

      const data = extractTaskResultData(task)

      expect(data.taskId).toBe("bg_test123")
      expect(data.description).toBe("Test task")
      expect(data.status).toBe("completed")
      expect(data.duration).toBe("5m 0s")
    })
  })

  describe("#given an error task", () => {
    test("extracts error information", () => {
      const task = createMockTask({
        status: "error",
        error: "Something went wrong",
      })

      const data = extractTaskResultData(task)

      expect(data.status).toBe("error")
      expect(data.error).toBe("Something went wrong")
    })
  })

  describe("#given a task without optional fields", () => {
    test("handles missing sessionID and result", () => {
      const task = createMockTask({
        sessionID: undefined,
        result: undefined,
      })

      const data = extractTaskResultData(task)

      expect(data.sessionID).toBeUndefined()
      expect(data.result).toBeUndefined()
    })
  })
})

describe("compressTaskResult", () => {
  describe("#given compression enabled", () => {
    test("returns JSON string for small data", () => {
      const data = {
        taskId: "bg_test",
        description: "Small task",
        status: "completed",
      }

      const result = compressTaskResult(data, DEFAULT_CONFIG)

      expect(result).toContain("bg_test")
      expect(result).toContain("Small task")
    })

    test("handles error data", () => {
      const data = {
        taskId: "bg_error",
        description: "Failed task",
        status: "error",
        error: "Connection timeout",
      }

      const result = compressTaskResult(data, DEFAULT_CONFIG)

      expect(result).toContain("error")
      expect(result).toContain("Connection timeout")
    })
  })

  describe("#given compression disabled", () => {
    test("returns plain JSON string", () => {
      const data = {
        taskId: "bg_test",
        description: "Test task",
        status: "completed",
      }

      const result = compressTaskResult(data, DISABLED_CONFIG)

      expect(result).toContain("bg_test")
      expect(result).toContain("Test task")
    })
  })
})

describe("compressTaskResults", () => {
  describe("#given multiple tasks", () => {
    test("compresses array of tasks", () => {
      const tasks = [
        createMockTask({ id: "bg_001", description: "First task" }),
        createMockTask({ id: "bg_002", description: "Second task" }),
        createMockTask({ id: "bg_003", description: "Third task" }),
      ]

      const result = compressTaskResults(tasks, { enabled: true, threshold: 1 })

      expect(result).toContain("bg_001")
      expect(result).toContain("bg_002")
      expect(result).toContain("bg_003")
    })

    test("handles empty array", () => {
      const result = compressTaskResults([], DEFAULT_CONFIG)

      expect(result).toBe("[]")
    })
  })

  describe("#given tasks with mixed statuses", () => {
    test("compresses completed and error tasks together", () => {
      const tasks = [
        createMockTask({ id: "bg_001", status: "completed", description: "Done" }),
        createMockTask({ id: "bg_002", status: "error", error: "Failed" }),
      ]

      const result = compressTaskResults(tasks, DEFAULT_CONFIG)

      expect(result).toContain("completed")
      expect(result).toContain("error")
    })
  })
})

describe("formatCompressedNotification", () => {
  describe("#given compressed data", () => {
    test("formats notification with task count", () => {
      const compressedData = "compressed_payload_here"
      const result = formatCompressedNotification(compressedData, 3)

      expect(result).toContain("[BACKGROUND TASK RESULTS - COMPRESSED]")
      expect(result).toContain("**Tasks:** 3")
      expect(result).toContain("**Format:** TOON (compressed)")
      expect(result).toContain("compressed_payload_here")
    })

    test("includes background_output instruction", () => {
      const result = formatCompressedNotification("data", 1)

      expect(result).toContain("background_output")
    })

    test("wraps data in code block", () => {
      const result = formatCompressedNotification("test_data", 2)

      expect(result).toContain("```toon")
      expect(result).toContain("test_data")
      expect(result).toContain("```")
    })
  })

  describe("#given single task", () => {
    test("formats notification for single task", () => {
      const result = formatCompressedNotification("single_result", 1)

      expect(result).toContain("**Tasks:** 1")
    })
  })

  describe("#given multiple tasks", () => {
    test("formats notification for multiple tasks", () => {
      const result = formatCompressedNotification("batch_results", 10)

      expect(result).toContain("**Tasks:** 10")
    })
  })
})
