import { describe, test, expect } from "bun:test"
import { TaskSchema, TaskStatusSchema, type Task, type TaskStatus } from "./types"

describe("TaskStatusSchema", () => {
  test("accepts valid status values", () => {
    //#given
    const validStatuses: TaskStatus[] = ["pending", "in_progress", "completed", "deleted"]

    //#when
    const results = validStatuses.map((status) => TaskStatusSchema.safeParse(status))

    //#then
    results.forEach((result) => {
      expect(result.success).toBe(true)
    })
  })

  test("rejects invalid status values", () => {
    //#given
    const invalidStatuses = ["open", "closed", "archived", ""]

    //#when
    const results = invalidStatuses.map((status) => TaskStatusSchema.safeParse(status))

    //#then
    results.forEach((result) => {
      expect(result.success).toBe(false)
    })
  })
})

describe("TaskSchema", () => {
  test("parses valid Task with all required fields", () => {
    //#given
    const validTask = {
      id: "1",
      subject: "Run tests",
      description: "Execute test suite",
      status: "pending" as TaskStatus,
      blocks: [],
      blockedBy: [],
    }

    //#when
    const result = TaskSchema.safeParse(validTask)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe("1")
      expect(result.data.subject).toBe("Run tests")
      expect(result.data.status).toBe("pending")
      expect(result.data.blocks).toEqual([])
      expect(result.data.blockedBy).toEqual([])
    }
  })

  test("parses Task with optional fields", () => {
    //#given
    const taskWithOptionals: Task = {
      id: "2",
      subject: "Deploy app",
      description: "Deploy to production",
      status: "in_progress",
      activeForm: "Deploying app",
      blocks: ["3", "4"],
      blockedBy: ["1"],
      owner: "sisyphus",
      metadata: { priority: "high", tags: ["urgent"] },
    }

    //#when
    const result = TaskSchema.safeParse(taskWithOptionals)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeForm).toBe("Deploying app")
      expect(result.data.owner).toBe("sisyphus")
      expect(result.data.metadata).toEqual({ priority: "high", tags: ["urgent"] })
    }
  })

  test("validates blocks and blockedBy as arrays", () => {
    //#given
    const taskWithDeps = {
      id: "3",
      subject: "Test feature",
      description: "Test new feature",
      status: "pending" as TaskStatus,
      blocks: ["4", "5", "6"],
      blockedBy: ["1", "2"],
    }

    //#when
    const result = TaskSchema.safeParse(taskWithDeps)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Array.isArray(result.data.blocks)).toBe(true)
      expect(result.data.blocks).toHaveLength(3)
      expect(Array.isArray(result.data.blockedBy)).toBe(true)
      expect(result.data.blockedBy).toHaveLength(2)
    }
  })

  test("rejects Task missing required fields", () => {
    //#given
    const invalidTasks = [
      { subject: "No ID", description: "Missing id", status: "pending", blocks: [], blockedBy: [] },
      { id: "1", description: "No subject", status: "pending", blocks: [], blockedBy: [] },
      { id: "1", subject: "No description", status: "pending", blocks: [], blockedBy: [] },
      { id: "1", subject: "No status", description: "Missing status", blocks: [], blockedBy: [] },
      { id: "1", subject: "No blocks", description: "Missing blocks", status: "pending", blockedBy: [] },
      { id: "1", subject: "No blockedBy", description: "Missing blockedBy", status: "pending", blocks: [] },
    ]

    //#when
    const results = invalidTasks.map((task) => TaskSchema.safeParse(task))

    //#then
    results.forEach((result) => {
      expect(result.success).toBe(false)
    })
  })

  test("rejects Task with invalid status", () => {
    //#given
    const taskWithInvalidStatus = {
      id: "1",
      subject: "Test",
      description: "Test task",
      status: "invalid_status",
      blocks: [],
      blockedBy: [],
    }

    //#when
    const result = TaskSchema.safeParse(taskWithInvalidStatus)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects Task with non-array blocks or blockedBy", () => {
    //#given
    const taskWithInvalidBlocks = {
      id: "1",
      subject: "Test",
      description: "Test task",
      status: "pending",
      blocks: "not-an-array",
      blockedBy: [],
    }

    const taskWithInvalidBlockedBy = {
      id: "1",
      subject: "Test",
      description: "Test task",
      status: "pending",
      blocks: [],
      blockedBy: "not-an-array",
    }

    //#when
    const result1 = TaskSchema.safeParse(taskWithInvalidBlocks)
    const result2 = TaskSchema.safeParse(taskWithInvalidBlockedBy)

    //#then
    expect(result1.success).toBe(false)
    expect(result2.success).toBe(false)
  })
})
