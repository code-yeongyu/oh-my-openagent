/// <reference types="bun-types" />

import { describe, test, expect, beforeEach } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
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

function createMockClient(responseText = "Test result content"): BackgroundOutputClient {
  return {
    session: {
      messages: async () => [{
        id: "msg_1",
        info: { role: "assistant", time: new Date().toISOString() },
        parts: [{ type: "text", text: responseText }],
      }],
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
      test("#then returns JSON with error and empty members", async () => {
        const manager = createMockManager({})
        const client = createMockClient()
        const tool = createBackgroundWait(manager, client)

        const result = await tool.execute({ task_ids: [] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.error).toBe("task_ids array is required and must not be empty.")
        expect(parsed.members).toEqual([])
        expect(parsed.remaining_task_ids).toEqual([])
        expect(parsed.completed_task).toBeNull()
        expect(parsed.timeout).toBe(false)
        expect(parsed.aborted).toBe(false)
      })
    })
  })

  describe("#given a completed council task", () => {
    describe("#when execute is called with that task_id", () => {
      test("#then returns JSON with council-specific fields", async () => {
        const councilResponse = "<COUNCIL_MEMBER_RESPONSE>Council verdict here</COUNCIL_MEMBER_RESPONSE>"
        const manager = createMockManager({
          "task-1": {
            status: "completed",
            agent: "Council: Opus",
            description: "Council analysis",
            startedAt: new Date(Date.now() - 5000),
            completedAt: new Date(),
          },
        })
        const client = createMockClient(councilResponse)
        const tool = createBackgroundWait(manager, client)

        const result = await tool.execute({ task_ids: ["task-1"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_task).toBeDefined()
        expect(parsed.completed_task.task_id).toBe("task-1")
        expect(parsed.completed_task.status).toBe("completed")
        expect(parsed.completed_task.has_response).toBe(true)
        expect(parsed.completed_task.response_complete).toBe(true)
        expect(parsed.completed_task.result).toBe("Council verdict here")
        expect(parsed.completed_task.duration_s).toBeTypeOf("number")
        expect(parsed.timeout).toBe(false)
        expect(parsed.aborted).toBe(false)
      })
    })
  })

  describe("#given a completed non-council task", () => {
    describe("#when execute is called with that task_id", () => {
      test("#then returns JSON with result as string and no council fields", async () => {
        const manager = createMockManager({
          "task-2": {
            status: "completed",
            agent: "explore",
            description: "Explore codebase",
            startedAt: new Date(Date.now() - 3000),
            completedAt: new Date(),
          },
        })
        const client = createMockClient("Exploration complete: found 5 files")
        const tool = createBackgroundWait(manager, client)

        const result = await tool.execute({ task_ids: ["task-2"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_task).toBeDefined()
        expect(parsed.completed_task.task_id).toBe("task-2")
        expect(parsed.completed_task.status).toBe("completed")
        expect(parsed.completed_task.result).toBeTypeOf("string")
        expect(parsed.completed_task.result).toContain("Exploration complete")
        expect(parsed.completed_task.has_response).toBeUndefined()
        expect(parsed.completed_task.response_complete).toBeUndefined()
        expect(parsed.timeout).toBe(false)
      })
    })
  })

  describe("#given an error task", () => {
    describe("#when execute is called with that task_id", () => {
      test("#then returns JSON with error field on completed_task", async () => {
        const manager = createMockManager({
          "task-3": {
            status: "error",
            agent: "explore",
            description: "Failed task",
            error: "Model failed",
            startedAt: new Date(Date.now() - 2000),
          },
        })
        const client = createMockClient()
        const tool = createBackgroundWait(manager, client)

        const result = await tool.execute({ task_ids: ["task-3"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_task).toBeDefined()
        expect(parsed.completed_task.task_id).toBe("task-3")
        expect(parsed.completed_task.status).toBe("error")
        expect(parsed.completed_task.error).toBe("Model failed")
        expect(parsed.completed_task.result).toBeUndefined()
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
        const client = createMockClient()
        const tool = createBackgroundWait(manager, client)

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
      test("#then completed task returns immediately and running task appears in members with session_state", async () => {
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
        const client = createMockClient("Done result")
        const tool = createBackgroundWait(manager, client)

        const result = await tool.execute({ task_ids: ["running-task", "done-task"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_task.task_id).toBe("done-task")

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
        const client = createMockClient("Result from t2")
        const tool = createBackgroundWait(manager, client)

        const result = await tool.execute({ task_ids: ["t1", "t2", "t3"] }, toolContext)

        const parsed = JSON.parse(result)
        expect(parsed.completed_task.task_id).toBe("t2")
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

  describe("#given all results from every code path", () => {
    describe("#when JSON.parse is applied to each result", () => {
      test("#then every result is valid JSON", async () => {
        const now = new Date()
        const results: string[] = []

        const emptyTool = createBackgroundWait(createMockManager({}), createMockClient())
        results.push(await emptyTool.execute({ task_ids: [] }, toolContext))

        const councilTool = createBackgroundWait(
          createMockManager({
            "c1": {
              status: "completed",
              agent: "Council: Opus",
              startedAt: now,
              completedAt: now,
            },
          }),
          createMockClient("<COUNCIL_MEMBER_RESPONSE>verdict</COUNCIL_MEMBER_RESPONSE>"),
        )
        results.push(await councilTool.execute({ task_ids: ["c1"] }, toolContext))

        resetMessageCursor()
        const nonCouncilTool = createBackgroundWait(
          createMockManager({
            "nc1": {
              status: "completed",
              agent: "explore",
              startedAt: now,
              completedAt: now,
            },
          }),
          createMockClient("result text"),
        )
        results.push(await nonCouncilTool.execute({ task_ids: ["nc1"] }, toolContext))

        const errorTool = createBackgroundWait(
          createMockManager({ "e1": { status: "error", error: "boom" } }),
          createMockClient(),
        )
        results.push(await errorTool.execute({ task_ids: ["e1"] }, toolContext))

        const abortController = new AbortController()
        abortController.abort()
        const abortedContext = { ...toolContext, abort: abortController.signal }
        const notFoundTool = createBackgroundWait(createMockManager({}), createMockClient())
        results.push(await notFoundTool.execute({ task_ids: ["missing"] }, abortedContext))

        const cancelledTool = createBackgroundWait(
          createMockManager({ "x1": { status: "cancelled", agent: "explore" } }),
          createMockClient(),
        )
        results.push(await cancelledTool.execute({ task_ids: ["x1"] }, toolContext))

        for (const result of results) {
          expect(() => JSON.parse(result)).not.toThrow()
        }
      })
    })
  })
})
