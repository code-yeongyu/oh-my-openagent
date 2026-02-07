import { describe, expect, it, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createCompactionTodoPreserverHook } from "./index"

const updateMock = mock(async () => {})

mock.module("opencode/session/todo", () => ({
  Todo: {
    update: updateMock,
  },
}))

type TodoSnapshot = {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "low" | "medium" | "high"
}

function createMockContext(todoResponses: TodoSnapshot[][]): PluginInput {
  let callIndex = 0
  return {
    client: {
      session: {
        todo: async () => {
          const current = todoResponses[Math.min(callIndex, todoResponses.length - 1)] ?? []
          callIndex += 1
          return { data: current }
        },
      },
    },
    directory: "/tmp/test",
  } as PluginInput
}

describe("compaction-todo-preserver", () => {
  it("restores todos after compaction when missing", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-missing"
    const todos = [
      { id: "1", content: "Task 1", status: "pending", priority: "high" },
      { id: "2", content: "Task 2", status: "in_progress", priority: "medium" },
    ]
    const ctx = createMockContext([todos, []])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({ sessionID, todos })
  })

  it("skips restore when todos already present", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-present"
    const todos = [
      { id: "1", content: "Task 1", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([todos, todos])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })
})
