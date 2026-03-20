import { describe, expect, it, afterAll, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Todo } from "@opencode-ai/sdk"
import { createCompactionTodoPreserverHook } from "./index"

const updateMock = mock(async () => {})

mock.module("opencode/session/todo", () => ({
  Todo: {
    update: updateMock,
  },
}))

afterAll(() => {
  mock.module("opencode/session/todo", () => ({
    Todo: {
      update: async () => {},
    },
  }))
})

function createMockContext(todoResponses: Array<Todo>[]): PluginInput {
  let callIndex = 0

  const client = createOpencodeClient({ directory: "/tmp/test" })
  type SessionTodoOptions = Parameters<typeof client.session.todo>[0]
  type SessionTodoResult = ReturnType<typeof client.session.todo>

  const request = new Request("http://localhost")
  const response = new Response()
  client.session.todo = mock((_: SessionTodoOptions): SessionTodoResult => {
    const current = todoResponses[Math.min(callIndex, todoResponses.length - 1)] ?? []
    callIndex += 1
    return Promise.resolve({ data: current, error: undefined, request, response })
  })

  return {
    client,
    project: { id: "test-project", worktree: "/tmp/test", time: { created: Date.now() } },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost"),
    $: Bun.$,
  }
}

describe("compaction-todo-preserver", () => {
  it("restores todos after compaction when missing", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-missing"
    const todos: Todo[] = [
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
    const todos: Todo[] = [
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
