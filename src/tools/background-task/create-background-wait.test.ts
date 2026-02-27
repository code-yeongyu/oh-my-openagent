/// <reference types="bun-types" />

import { describe, test, expect, beforeEach } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputManager } from "./clients"
import { createBackgroundWait } from "./create-background-wait"
import { resetMessageCursor } from "../../shared/session-cursor"

function createMockManager(tasks: Record<string, Partial<BackgroundTask>>): BackgroundOutputManager {
  return {
    getTask: (id: string) => {
      const partial = tasks[id]
      if (!partial) return undefined
      return {
        id,
        parentSessionID: "parent",
        parentMessageID: "parent-msg",
        description: partial.description ?? `Task ${id}`,
        prompt: "test",
        agent: partial.agent ?? "test-agent",
        status: partial.status ?? "running",
        sessionID: partial.sessionID ?? `session-${id}`,
        ...partial,
      } as BackgroundTask
    },
  }
}

const toolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

describe("createBackgroundWait", () => {
  beforeEach(() => {
    resetMessageCursor()
  })

  describe("#given empty task_ids", () => {
    describe("#when execute is called with empty array", () => {
      test("#then returns JSON with error and empty completed_tasks", async () => {
        const manager = createMockManager({})
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: [] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.error).toBe("task_ids array is required and must not be empty.")
        expect(parsed.members).toEqual([])
        expect(parsed.remaining_task_ids).toEqual([])
        expect(parsed.completed_tasks).toEqual([])
        expect(parsed.timeout).toBe(false)
        expect(parsed.aborted).toBe(false)
      })
    })
  })

  describe("#given a completed task", () => {
    describe("#when execute is called with that task_id", () => {
      test("#then returns metadata-only completed_tasks array with no result field", async () => {
        const manager = createMockManager({
          "task-1": {
            status: "completed",
            agent: "Council: Opus",
            description: "Council analysis",
            startedAt: new Date(Date.now() - 5000),
            completedAt: new Date(),
          },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["task-1"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_tasks).toBeArray()
        expect(parsed.completed_tasks).toHaveLength(1)
        expect(parsed.completed_tasks[0].task_id).toBe("task-1")
        expect(parsed.completed_tasks[0].status).toBe("completed")
        expect(parsed.completed_tasks[0].description).toBe("Council analysis")
        expect(parsed.completed_tasks[0].duration_s).toBeTypeOf("number")
        expect(parsed.completed_tasks[0].session_id).toBeDefined()
        expect(parsed.completed_tasks[0].result).toBeUndefined()
        expect(parsed.completed_tasks[0].has_response).toBeUndefined()
        expect(parsed.completed_tasks[0].response_complete).toBeUndefined()
        expect(parsed.timeout).toBe(false)
        expect(parsed.aborted).toBe(false)
      })
    })
  })

  describe("#given a completed non-council task", () => {
    describe("#when execute is called with that task_id", () => {
      test("#then returns metadata-only entry with no result field", async () => {
        const manager = createMockManager({
          "task-2": {
            status: "completed",
            agent: "explore",
            description: "Explore codebase",
            startedAt: new Date(Date.now() - 3000),
            completedAt: new Date(),
          },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["task-2"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_tasks).toBeArray()
        expect(parsed.completed_tasks).toHaveLength(1)
        expect(parsed.completed_tasks[0].task_id).toBe("task-2")
        expect(parsed.completed_tasks[0].status).toBe("completed")
        expect(parsed.completed_tasks[0].description).toBe("Explore codebase")
        expect(parsed.completed_tasks[0].result).toBeUndefined()
        expect(parsed.completed_tasks[0].has_response).toBeUndefined()
        expect(parsed.completed_tasks[0].response_complete).toBeUndefined()
        expect(parsed.timeout).toBe(false)
      })
    })
  })

  describe("#given an error task", () => {
    describe("#when execute is called with that task_id", () => {
      test("#then returns completed_tasks entry with error field and no result", async () => {
        const manager = createMockManager({
          "task-3": {
            status: "error",
            agent: "explore",
            description: "Failed task",
            error: "Model failed",
            startedAt: new Date(Date.now() - 2000),
          },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["task-3"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_tasks).toBeArray()
        expect(parsed.completed_tasks).toHaveLength(1)
        expect(parsed.completed_tasks[0].task_id).toBe("task-3")
        expect(parsed.completed_tasks[0].status).toBe("error")
        expect(parsed.completed_tasks[0].error).toBe("Model failed")
        expect(parsed.completed_tasks[0].result).toBeUndefined()
        expect(parsed.timeout).toBe(false)
      })
    })
  })

  describe("#given a task_id not found in manager", () => {
    describe("#when execute is called with unknown task_id", () => {
      test("#then returns JSON with not_found member in members array", async () => {
        const manager = createMockManager({
          "known-task": { status: "completed", agent: "explore" },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["known-task", "unknown-task"] }, toolContext)

        const parsed = JSON.parse(result)
        const unknownMember = parsed.members.find((m: Record<string, unknown>) => m.task_id === "unknown-task")
        expect(unknownMember).toBeDefined()
        expect(unknownMember.status).toBe("not_found")
      })
    })
  })

  describe("#given a running task with session state and progress", () => {
    describe("#when that task plus a completed task are waited on", () => {
      test("#then completed task appears in completed_tasks and running task in members with session_state", async () => {
        const now = new Date()
        const manager = createMockManager({
          "running-task": {
            status: "running",
            agent: "explore",
            description: "Still running",
            sessionState: "running",
            progress: { lastUpdate: now, toolCalls: 5 },
          },
          "done-task": {
            status: "completed",
            agent: "explore",
            description: "Already done",
            startedAt: new Date(Date.now() - 1000),
            completedAt: now,
          },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["running-task", "done-task"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_tasks).toBeArray()
        expect(parsed.completed_tasks).toHaveLength(1)
        expect(parsed.completed_tasks[0].task_id).toBe("done-task")

        const runningMember = parsed.members.find((m: Record<string, unknown>) => m.task_id === "running-task")
        expect(runningMember).toBeDefined()
        expect(runningMember.session_state).toBe("running")
        expect(runningMember.last_activity_s).toBeTypeOf("number")
        expect(runningMember.tool_calls).toBe(5)
      })
    })
  })

  describe("#given multiple tasks with one completed", () => {
    describe("#when execute is called with all three task_ids", () => {
      test("#then remaining_task_ids contains the non-terminal tasks", async () => {
        const manager = createMockManager({
          "t1": { status: "running", agent: "explore" },
          "t2": { status: "completed", agent: "explore", startedAt: new Date() },
          "t3": { status: "running", agent: "oracle" },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["t1", "t2", "t3"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_tasks).toBeArray()
        expect(parsed.completed_tasks).toHaveLength(1)
        expect(parsed.completed_tasks[0].task_id).toBe("t2")
        expect(parsed.remaining_task_ids).toContain("t1")
        expect(parsed.remaining_task_ids).toContain("t3")
        expect(parsed.remaining_task_ids).not.toContain("t2")
        expect(parsed.remaining_task_ids).toHaveLength(2)
        expect(parsed.progress.done).toBe(1)
        expect(parsed.progress.total).toBe(3)
        expect(parsed.progress.bar).toBe("#--")
      })
    })
  })

  describe("#given a task with outputFilePath", () => {
    describe("#when execute is called with that task_id", () => {
      test("#then completed_tasks entry includes output_file_path", async () => {
        const manager = createMockManager({
          "task-out": {
            status: "completed",
            agent: "explore",
            description: "Task with output",
            startedAt: new Date(Date.now() - 1000),
            completedAt: new Date(),
            outputFilePath: "/tmp/output-task-out.md",
          },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["task-out"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_tasks[0].output_file_path).toBe("/tmp/output-task-out.md")
      })
    })
  })

  describe("#given multiple terminal tasks", () => {
    describe("#when execute is called with all task_ids", () => {
      test("#then completed_tasks contains ALL terminal tasks", async () => {
        const manager = createMockManager({
          "t1": { status: "completed", agent: "explore", startedAt: new Date(), completedAt: new Date() },
          "t2": { status: "error", agent: "oracle", error: "failed", startedAt: new Date() },
          "t3": { status: "running", agent: "explore" },
        })
        const tool = createBackgroundWait(manager)

        const result = await tool.execute({ task_ids: ["t1", "t2", "t3"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_tasks).toBeArray()
        expect(parsed.completed_tasks).toHaveLength(2)
        const ids = parsed.completed_tasks.map((t: Record<string, unknown>) => t.task_id)
        expect(ids).toContain("t1")
        expect(ids).toContain("t2")
        expect(parsed.remaining_task_ids).toEqual(["t3"])
      })
    })
  })

  describe("#given all results from every code path", () => {
    describe("#when JSON.parse is applied to each result", () => {
      test("#then every result is valid JSON with completed_tasks array", async () => {
        const now = new Date()
        const results: string[] = []

        const emptyTool = createBackgroundWait(createMockManager({}))
        results.push(await emptyTool.execute({ task_ids: [] }, toolContext))

        const completedTool = createBackgroundWait(
          createMockManager({
            "c1": {
              status: "completed",
              agent: "Council: Opus",
              startedAt: now,
              completedAt: now,
            },
          }),
        )
        results.push(await completedTool.execute({ task_ids: ["c1"] }, toolContext))

        resetMessageCursor()
        const exploreTool = createBackgroundWait(
          createMockManager({
            "nc1": {
              status: "completed",
              agent: "explore",
              startedAt: now,
              completedAt: now,
            },
          }),
        )
        results.push(await exploreTool.execute({ task_ids: ["nc1"] }, toolContext))

        const errorTool = createBackgroundWait(
          createMockManager({ "e1": { status: "error", error: "boom" } }),
        )
        results.push(await errorTool.execute({ task_ids: ["e1"] }, toolContext))

        const abortController = new AbortController()
        abortController.abort()
        const abortedContext = { ...toolContext, abort: abortController.signal }
        const notFoundTool = createBackgroundWait(createMockManager({}))
        results.push(await notFoundTool.execute({ task_ids: ["missing"] }, abortedContext))

        const cancelledTool = createBackgroundWait(
          createMockManager({ "x1": { status: "cancelled", agent: "explore" } }),
        )
        results.push(await cancelledTool.execute({ task_ids: ["x1"] }, toolContext))

        for (const result of results) {
          const parsed = JSON.parse(result)
          expect(parsed).toBeDefined()
          expect(Array.isArray(parsed.completed_tasks)).toBe(true)
        }
      })
    })
  })
})
