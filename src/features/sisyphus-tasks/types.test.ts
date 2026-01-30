import { describe, it, expect } from "bun:test"
import { TaskSchema, TaskStatusSchema, type Task } from "./types"

describe("TaskSchema", () => {
  //#given a valid task object
  //#when parsing with TaskSchema
  //#then it should succeed
  it("parses valid task object", () => {
    const validTask = {
      id: "1",
      subject: "Fix authentication bug",
      description: "Users report 401 errors",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }

    const result = TaskSchema.safeParse(validTask)
    expect(result.success).toBe(true)
  })

  //#given a task with all optional fields
  //#when parsing with TaskSchema
  //#then it should succeed
  it("parses task with optional fields", () => {
    const taskWithOptionals = {
      id: "2",
      subject: "Add unit tests",
      description: "Write tests for auth module",
      activeForm: "Adding unit tests",
      owner: "agent-001",
      status: "in_progress",
      blocks: ["3"],
      blockedBy: ["1"],
      metadata: { priority: "high", labels: ["bug"] },
    }

    const result = TaskSchema.safeParse(taskWithOptionals)
    expect(result.success).toBe(true)
  })

  //#given an invalid status value
  //#when parsing with TaskSchema
  //#then it should fail
  it("rejects invalid status", () => {
    const invalidTask = {
      id: "1",
      subject: "Test",
      description: "Test",
      status: "invalid_status",
      blocks: [],
      blockedBy: [],
    }

    const result = TaskSchema.safeParse(invalidTask)
    expect(result.success).toBe(false)
  })

  //#given missing required fields
  //#when parsing with TaskSchema
  //#then it should fail
  it("rejects missing required fields", () => {
    const invalidTask = {
      id: "1",
      // missing subject, description, status, blocks, blockedBy
    }

    const result = TaskSchema.safeParse(invalidTask)
    expect(result.success).toBe(false)
  })
})

describe("TaskStatusSchema", () => {
  //#given valid status values
  //#when parsing
  //#then all should succeed
  it("accepts valid statuses", () => {
    expect(TaskStatusSchema.safeParse("pending").success).toBe(true)
    expect(TaskStatusSchema.safeParse("in_progress").success).toBe(true)
    expect(TaskStatusSchema.safeParse("completed").success).toBe(true)
  })
})
