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
  mock.restore()
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

  // #given a richer pre-compact snapshot
  // #when post-compaction todos are only the Atlas bootstrap pair
  // #then the snapshot should be restored, not the bootstrap stub (issue #3833)
  it("restores richer snapshot when post-compaction todos are only Atlas bootstrap items (issue #3833)", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-atlas-bootstrap"
    const richSnapshot: Todo[] = [
      { id: "task-1", content: "Implement feature A", status: "in_progress", priority: "high" },
      { id: "task-2", content: "Write tests for feature A", status: "pending", priority: "high" },
      { id: "task-3", content: "Update documentation", status: "pending", priority: "medium" },
    ]
    const atlasBootstrap: Todo[] = [
      { id: "orchestrate-plan", content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { id: "pass-final-wave", content: "Pass Final Verification Wave - ALL reviewers APPROVE", status: "pending", priority: "high" },
    ]
    // First todo() call returns the rich snapshot during capture; second returns the Atlas bootstrap during restore
    const ctx = createMockContext([richSnapshot, atlasBootstrap])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then: rich snapshot wins, the bootstrap pair does not
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({ sessionID, todos: richSnapshot })
  })

  // #given a captured snapshot that itself is the Atlas bootstrap
  // #when post-compaction shows the same Atlas bootstrap
  // #then restore must NOT thrash the list (no Todo.update call) (issue #3833)
  it("does not overwrite when both snapshot and current todos are the Atlas bootstrap pair (issue #3833)", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-atlas-bootstrap-only"
    const atlasBootstrap: Todo[] = [
      { id: "orchestrate-plan", content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { id: "pass-final-wave", content: "Pass Final Verification Wave - ALL reviewers APPROVE", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([atlasBootstrap, atlasBootstrap])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then: nothing to restore beyond what is already present
    expect(updateMock).not.toHaveBeenCalled()
  })
})
