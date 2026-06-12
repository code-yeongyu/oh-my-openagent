import { describe, expect, it, afterAll, beforeEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Todo } from "@opencode-ai/sdk"
import { createCompactionTodoPreserverHook } from "./index"

const updateMock = mock(async () => {})
let todoWriter: typeof updateMock | undefined = updateMock

mock.module("opencode/session/todo", () => ({
  Todo: {
    get update() {
      return todoWriter
    },
  },
}))

beforeEach(() => {
  todoWriter = updateMock
})

afterAll(() => {
  mock.module("opencode/session/todo", () => ({
    Todo: {
      update: async () => {},
    },
  }))
  mock.restore()
})

type TodoResponse = Todo[] | Error

function createMockContext(todoResponses: TodoResponse[]): PluginInput {
  let callIndex = 0

  const client = createOpencodeClient({ directory: "/tmp/test" })
  type SessionTodoOptions = Parameters<typeof client.session.todo>[0]
  type SessionTodoResult = ReturnType<typeof client.session.todo>

  const request = new Request("http://localhost")
  const response = new Response()
  client.session.todo = mock((_: SessionTodoOptions): SessionTodoResult => {
    const current = todoResponses[Math.min(callIndex, todoResponses.length - 1)] ?? []
    callIndex += 1
    if (current instanceof Error) {
      return Promise.reject(current)
    }
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
      { content: "Task 1", status: "pending", priority: "high" },
      { content: "Task 2", status: "in_progress", priority: "medium" },
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
      { content: "Task 1", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([todos, todos])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("restores detailed todos when only Atlas bootstrap todos are present after compaction", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-atlas-bootstrap"
    const detailedTodos: Todo[] = [
      { content: "Inspect runtime compaction state", status: "completed", priority: "high" },
      { content: "Add regression coverage for todo preservation", status: "in_progress", priority: "high" },
      { content: "Run focused tests and open PR", status: "pending", priority: "medium" },
    ]
    const atlasBootstrapTodos: Todo[] = [
      { content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { content: "Pass Final Verification Wave - ALL reviewers APPROVE", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([detailedTodos, atlasBootstrapTodos])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({ sessionID, todos: detailedTodos })
  })

  it("skips restore when current todos include meaningful post-compaction work", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-meaningful-current"
    const detailedTodos: Todo[] = [
      { content: "Inspect runtime compaction state", status: "completed", priority: "high" },
      { content: "Add regression coverage for todo preservation", status: "in_progress", priority: "high" },
    ]
    const currentTodos: Todo[] = [
      { content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { content: "Review post-compaction findings", status: "pending", priority: "medium" },
    ]
    const ctx = createMockContext([detailedTodos, currentTodos])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("does not restore a stale snapshot after a later empty capture", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-empty-later"
    const oldTodos: Todo[] = [
      { content: "Old task that no longer exists", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([oldTodos, []])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("does not restore a stale snapshot after a later failed capture", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-failed-later"
    const oldTodos: Todo[] = [
      { content: "Old task that should not come back", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([oldTodos, new Error("todo api unavailable")])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("does not retain a stale snapshot when Todo.update is unavailable", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-writer-unavailable"
    const detailedTodos: Todo[] = [
      { content: "Detailed task before missing writer", status: "in_progress", priority: "high" },
    ]
    const ctx = createMockContext([detailedTodos, [], []])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    todoWriter = undefined
    await hook.restore(sessionID)
    todoWriter = updateMock
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("does not preserve Atlas bootstrap todos when they are the only pre-compaction snapshot", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-bootstrap-only-snapshot"
    const atlasBootstrapTodos: Todo[] = [
      { content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { content: "Pass Final Verification Wave - ALL reviewers APPROVE", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([atlasBootstrapTodos, []])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("preserves restored detailed todos when Atlas writes bootstrap todos after compaction", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-late-atlas-bootstrap"
    const detailedTodos: Todo[] = [
      { content: "Inspect runtime compaction state", status: "completed", priority: "high" },
      { content: "Add regression coverage for todo preservation", status: "in_progress", priority: "high" },
      { content: "Run focused tests and open PR", status: "pending", priority: "medium" },
    ]
    const atlasBootstrapTodos: Todo[] = [
      { content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { content: "Pass Final Verification Wave - ALL reviewers APPROVE", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([detailedTodos, []])
    const hook = createCompactionTodoPreserverHook(ctx)
    const output = { args: { todos: atlasBootstrapTodos } }

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })
    await hook["tool.execute.before"]({ tool: "todowrite", sessionID, callID: "call-bootstrap" }, output)

    //#then
    expect(updateMock).toHaveBeenCalledWith({ sessionID, todos: detailedTodos })
    expect(output.args.todos).toEqual(detailedTodos)
  })

  it("protects detailed current todos from a later Atlas bootstrap write after compaction", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-detailed-current-late-bootstrap"
    const detailedTodos: Todo[] = [
      { content: "Keep detailed task one", status: "in_progress", priority: "high" },
      { content: "Keep detailed task two", status: "pending", priority: "medium" },
    ]
    const atlasBootstrapTodos: Todo[] = [
      { content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { content: "Pass Final Verification Wave - ALL reviewers APPROVE", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([detailedTodos, detailedTodos])
    const hook = createCompactionTodoPreserverHook(ctx)
    const output = { args: { todos: atlasBootstrapTodos } }

    //#when
    await hook.capture(sessionID)
    await hook.restore(sessionID)
    await hook["tool.execute.before"]({ tool: "todowrite", sessionID, callID: "call-bootstrap" }, output)

    //#then
    expect(updateMock).not.toHaveBeenCalled()
    expect(output.args.todos).toEqual(detailedTodos)
  })

  it("clears late bootstrap protection when the session idles", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-protection-idle"
    const detailedTodos: Todo[] = [
      { content: "Detailed task before idle", status: "in_progress", priority: "high" },
    ]
    const atlasBootstrapTodos: Todo[] = [
      { content: "Complete ALL implementation tasks", status: "in_progress", priority: "high" },
      { content: "Pass Final Verification Wave - ALL reviewers APPROVE", status: "pending", priority: "high" },
    ]
    const ctx = createMockContext([detailedTodos, detailedTodos])
    const hook = createCompactionTodoPreserverHook(ctx)
    const output = { args: { todos: atlasBootstrapTodos } }

    //#when
    await hook.capture(sessionID)
    await hook.restore(sessionID)
    await hook.event({ event: { type: "session.idle", properties: { sessionID } } })
    await hook["tool.execute.before"]({ tool: "todowrite", sessionID, callID: "call-bootstrap" }, output)

    //#then
    expect(output.args.todos).toEqual(atlasBootstrapTodos)
  })

  it("clears a pending snapshot when the session idles before restore", async () => {
    //#given
    updateMock.mockClear()
    const sessionID = "session-compaction-idle-before-restore"
    const detailedTodos: Todo[] = [
      { content: "Detailed task before interrupted compaction", status: "in_progress", priority: "high" },
    ]
    const ctx = createMockContext([detailedTodos, []])
    const hook = createCompactionTodoPreserverHook(ctx)

    //#when
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.idle", properties: { sessionID } } })
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })

    //#then
    expect(updateMock).not.toHaveBeenCalled()
  })
})
