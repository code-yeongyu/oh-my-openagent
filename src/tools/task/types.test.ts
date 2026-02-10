import { describe, test, expect } from "bun:test"
import {
  TaskStatusSchema,
  TaskSchema,
  TaskCreateInputSchema,
  TaskUpdateInputSchema,
  TaskListInputSchema,
  TaskGetInputSchema,
  TaskDeleteInputSchema,
} from "./types"

describe("TaskStatusSchema", () => {
  test("accepts valid status values", () => {
    //#given
    const validStatuses = ["pending", "in_progress", "completed", "deleted"]

    //#when
    const results = validStatuses.map((status) => TaskStatusSchema.safeParse(status))

    //#then
    expect(results.every((r) => r.success)).toBe(true)
  })

  test("rejects invalid status values", () => {
    //#given
    const invalidStatuses = ["open", "done", "archived", "unknown"]

    //#when
    const results = invalidStatuses.map((status) => TaskStatusSchema.safeParse(status))

    //#then
    expect(results.every((r) => !r.success)).toBe(true)
  })
})

describe("TaskSchema", () => {
  test("validates complete task object with all fields", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      activeForm: "Implementing feature",
      blocks: ["T-456"],
      blockedBy: ["T-789"],
      owner: "agent-name",
      metadata: { priority: "high" },
      repoURL: "https://github.com/example/repo",
      parentID: "T-parent",
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates task with only required fields", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      blocks: [],
      blockedBy: [],
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects task missing required subject field", () => {
    //#given
    const task = {
      id: "T-123",
      description: "Detailed description",
      status: "pending" as const,
      blocks: [],
      blockedBy: [],
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects task with invalid status", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "open",
      blocks: [],
      blockedBy: [],
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(false)
  })

  test("validates blocks as array of strings", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      blocks: ["T-456", "T-789"],
      blockedBy: [],
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates blockedBy as array of strings", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      blocks: [],
      blockedBy: ["T-456", "T-789"],
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates metadata as record of unknown values", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      blocks: [],
      blockedBy: [],
      metadata: {
        priority: "high",
        tags: ["urgent", "backend"],
        count: 42,
        nested: { key: "value" },
      },
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects extra fields with strict mode", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      blocks: [],
      blockedBy: [],
      threadID: "thread-123",
      extraField: "should not be here",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    expect(result.success).toBe(false)
  })

  test("defaults blocks to empty array", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      blockedBy: [],
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    if (result.success) {
      expect(result.data.blocks).toEqual([])
    }
  })

  test("defaults blockedBy to empty array", () => {
    //#given
    const task = {
      id: "T-123",
      subject: "Implement feature",
      description: "Detailed description",
      status: "pending" as const,
      blocks: [],
      threadID: "thread-123",
    }

    //#when
    const result = TaskSchema.safeParse(task)

    //#then
    if (result.success) {
      expect(result.data.blockedBy).toEqual([])
    }
  })
})

describe("TaskCreateInputSchema", () => {
  test("validates create input with required subject", () => {
    //#given
    const input = {
      subject: "Implement feature",
    }

    //#when
    const result = TaskCreateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates create input with all optional fields", () => {
    //#given
    const input = {
      subject: "Implement feature",
      description: "Detailed description",
      blockedBy: ["T-456"],
      blocks: ["T-789"],
      activeForm: "Implementing feature",
      owner: "agent-name",
      metadata: { priority: "high" },
      repoURL: "https://github.com/example/repo",
      parentID: "T-parent",
    }

    //#when
    const result = TaskCreateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects create input without subject", () => {
    //#given
    const input = {
      description: "Detailed description",
    }

    //#when
    const result = TaskCreateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })

  test("accepts blockedBy as array of strings", () => {
    //#given
    const input = {
      subject: "Implement feature",
      blockedBy: ["T-456", "T-789"],
    }

    //#when
    const result = TaskCreateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts blocks as array of strings", () => {
    //#given
    const input = {
      subject: "Implement feature",
      blocks: ["T-456", "T-789"],
    }

    //#when
    const result = TaskCreateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })
})

describe("TaskUpdateInputSchema", () => {
  test("validates update input with id and subject", () => {
    //#given
    const input = {
      id: "T-123",
      subject: "Updated subject",
    }

    //#when
    const result = TaskUpdateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates update input with id only", () => {
    //#given
    const input = {
      id: "T-123",
    }

    //#when
    const result = TaskUpdateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects update input without id", () => {
    //#given
    const input = {
      subject: "Updated subject",
    }

    //#when
    const result = TaskUpdateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })

  test("validates update with status change", () => {
    //#given
    const input = {
      id: "T-123",
      status: "in_progress" as const,
    }

    //#when
    const result = TaskUpdateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates update with blockedBy change", () => {
    //#given
    const input = {
      id: "T-123",
      blockedBy: ["T-456", "T-789"],
    }

    //#when
    const result = TaskUpdateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates update with blocks change", () => {
    //#given
    const input = {
      id: "T-123",
      blocks: ["T-456"],
    }

    //#when
    const result = TaskUpdateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates update with multiple fields", () => {
    //#given
    const input = {
      id: "T-123",
      subject: "Updated subject",
      description: "Updated description",
      status: "completed" as const,
      owner: "new-owner",
    }

    //#when
    const result = TaskUpdateInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })
})

describe("TaskListInputSchema", () => {
  test("validates empty list input", () => {
    //#given
    const input = {}

    //#when
    const result = TaskListInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates list input with status filter", () => {
    //#given
    const input = {
      status: "pending" as const,
    }

    //#when
    const result = TaskListInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates list input with parentID filter", () => {
    //#given
    const input = {
      parentID: "T-parent",
    }

    //#when
    const result = TaskListInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("validates list input with both filters", () => {
    //#given
    const input = {
      status: "in_progress" as const,
      parentID: "T-parent",
    }

    //#when
    const result = TaskListInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })
})

describe("TaskGetInputSchema", () => {
  test("validates get input with id", () => {
    //#given
    const input = {
      id: "T-123",
    }

    //#when
    const result = TaskGetInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects get input without id", () => {
    //#given
    const input = {}

    //#when
    const result = TaskGetInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })
})

describe("TaskDeleteInputSchema", () => {
  test("validates delete input with id", () => {
    //#given
    const input = {
      id: "T-123",
    }

    //#when
    const result = TaskDeleteInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects delete input without id", () => {
    //#given
    const input = {}

    //#when
    const result = TaskDeleteInputSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })
})
