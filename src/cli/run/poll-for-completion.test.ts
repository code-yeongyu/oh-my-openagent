import { describe, it, expect, mock, spyOn } from "bun:test"
import type { RunContext, Todo, ChildSession, SessionStatus } from "./types"
import { createEventState } from "./events"
import { pollForCompletion } from "./poll-for-completion"

const createMockContext = (overrides: {
  todo?: Todo[]
  childrenBySession?: Record<string, ChildSession[]>
  statuses?: Record<string, SessionStatus>
} = {}): RunContext => {
  const {
    todo = [],
    childrenBySession = { "test-session": [] },
    statuses = {},
  } = overrides

  return {
    client: {
      session: {
        todo: mock(() => Promise.resolve({ data: todo })),
        children: mock((opts: { path: { id: string } }) =>
          Promise.resolve({ data: childrenBySession[opts.path.id] ?? [] })
        ),
        status: mock(() => Promise.resolve({ data: statuses })),
      },
    } as unknown as RunContext["client"],
    sessionID: "test-session",
    directory: "/test",
    abortController: new AbortController(),
  }
}

describe("pollForCompletion", () => {
  it("requires consecutive stability checks before exiting - not immediate", async () => {
    //#given - 0 todos, 0 children, session idle, meaningful work done
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })

    //#then - exits with 0 but only after 3 consecutive checks
    expect(result).toBe(0)
    const todoCallCount = (ctx.client.session.todo as ReturnType<typeof mock>).mock.calls.length
    expect(todoCallCount).toBeGreaterThanOrEqual(3)
  })

  it("does not check completion during stabilization period after first meaningful work", async () => {
    //#given - session idle, meaningful work done, but stabilization period not elapsed
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when - abort after 50ms (within the 60ms stabilization period)
    setTimeout(() => abortController.abort(), 50)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 60,
    })

    //#then - should be aborted, not completed (stabilization blocked completion check)
    expect(result).toBe(130)
    const todoCallCount = (ctx.client.session.todo as ReturnType<typeof mock>).mock.calls.length
    expect(todoCallCount).toBe(0)
  })

  it("does not exit when currentTool is set - resets consecutive counter", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    eventState.currentTool = "task"
    const abortController = new AbortController()

    //#when - abort after enough time to verify it didn't exit
    setTimeout(() => abortController.abort(), 100)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then - should be aborted, not completed (tool blocked exit)
    expect(result).toBe(130)
    const todoCallCount = (ctx.client.session.todo as ReturnType<typeof mock>).mock.calls.length
    expect(todoCallCount).toBe(0)
  })

  it("resets consecutive counter when session becomes busy between checks", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()
    let todoCallCount = 0
    let busyInserted = false

    ;(ctx.client.session as any).todo = mock(async () => {
      todoCallCount++
      if (todoCallCount === 1 && !busyInserted) {
        busyInserted = true
        eventState.mainSessionIdle = false
        setTimeout(() => { eventState.mainSessionIdle = true }, 15)
      }
      return { data: [] }
    })
    ;(ctx.client.session as any).children = mock(() =>
      Promise.resolve({ data: [] })
    )
    ;(ctx.client.session as any).status = mock(() =>
      Promise.resolve({ data: {} })
    )

    //#when
    const startMs = Date.now()
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })
    const elapsedMs = Date.now() - startMs

    //#then - took longer than 3 polls because busy interrupted the streak
    expect(result).toBe(0)
    expect(elapsedMs).toBeGreaterThan(30)
  })

  it("returns 1 on session error", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.mainSessionError = true
    eventState.lastError = "Test error"
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then
    expect(result).toBe(1)
  })

  it("returns 130 when aborted", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    const abortController = new AbortController()

    //#when
    setTimeout(() => abortController.abort(), 50)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then
    expect(result).toBe(130)
  })

  it("does not check completion when hasReceivedMeaningfulWork is false", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()

    //#when
    setTimeout(() => abortController.abort(), 100)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then
    expect(result).toBe(130)
    const todoCallCount = (ctx.client.session.todo as ReturnType<typeof mock>).mock.calls.length
    expect(todoCallCount).toBe(0)
  })

  it("simulates race condition: brief idle with 0 todos does not cause immediate exit", async () => {
    //#given - simulate Sisyphus outputting text, session goes idle briefly, then tool fires
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()
    let pollTick = 0

    ;(ctx.client.session as any).todo = mock(async () => {
      pollTick++
      if (pollTick === 2) {
        eventState.currentTool = "task"
      }
      return { data: [] }
    })
    ;(ctx.client.session as any).children = mock(() =>
      Promise.resolve({ data: [] })
    )
    ;(ctx.client.session as any).status = mock(() =>
      Promise.resolve({ data: {} })
    )

    //#when - abort after tool stays in-flight
    setTimeout(() => abortController.abort(), 200)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then - should NOT have exited with 0 (tool blocked it, then aborted)
    expect(result).toBe(130)
  })

  it("returns 1 when session errors while not idle (error not masked by idle gate)", async () => {
    //#given - mainSessionIdle=false, mainSessionError=true, lastError="crash"
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = false
    eventState.mainSessionError = true
    eventState.lastError = "crash"
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when - pollForCompletion runs
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then - returns 1 (not 130/timeout), error message printed
    expect(result).toBe(1)
    const errorCalls = (console.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.some((call) => call[0]?.includes("Session ended with error"))).toBe(true)
  })

  it("returns 1 when session errors while tool is active (error not masked by tool gate)", async () => {
    //#given - mainSessionIdle=true, currentTool="bash", mainSessionError=true
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.currentTool = "bash"
    eventState.mainSessionError = true
    eventState.lastError = "error during tool"
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then - returns 1
    expect(result).toBe(1)
  })
})
