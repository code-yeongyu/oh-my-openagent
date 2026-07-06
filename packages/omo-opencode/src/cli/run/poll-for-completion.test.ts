import { afterEach, beforeEach, describe, it, expect, mock, spyOn } from "bun:test"
import type { RunContext, Todo, ChildSession, SessionStatus } from "./types"
import { createEventState } from "./events"
import { pollForCompletion } from "./poll-for-completion"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

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
    client: unsafeTestValue<RunContext["client"]>({
      session: {
        todo: mock(() => Promise.resolve({ data: todo })),
        children: mock((opts: { path: { id: string } }) =>
          Promise.resolve({ data: childrenBySession[opts.path.id] ?? [] })
        ),
        status: mock(() => Promise.resolve({ data: statuses })),
      },
    }),
    sessionID: "test-session",
    directory: "/test",
    abortController: new AbortController(),
  }
}

let consoleLogSpy: ReturnType<typeof spyOn>
let consoleErrorSpy: ReturnType<typeof spyOn>

function abortAfter(abortController: AbortController, delayMs: number): void {
  setTimeout(() => abortController.abort(), delayMs)
}

// Deterministic virtual clock for pollForCompletion. now() reads a mutable
// counter; sleep() advances it by the requested ms and yields a microtask so
// the loop's async continuations run without real wall-clock time. `onSleep`
// lets a test inject state changes (e.g. session goes busy then idle) keyed to
// virtual elapsed time, preserving the SAME causality the old real-time waits
// exercised — but deterministically, with no wall-clock race.
function createVirtualClock(onSleep?: (elapsedMs: number) => void): {
  now: () => number
  sleep: (ms: number) => Promise<void>
} {
  let currentMs = 0
  return {
    now: () => currentMs,
    sleep: async (ms: number) => {
      currentMs += ms
      onSleep?.(currentMs)
      await Promise.resolve()
    },
  }
}

beforeEach(() => {
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {})
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  consoleLogSpy.mockRestore()
  consoleErrorSpy.mockRestore()
})

describe("pollForCompletion", () => {
  it("requires consecutive stability checks before exiting - not immediate", async () => {
    //#given - 0 todos, 0 children, session idle, meaningful work done
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 10,
    })

    //#then - exits with 0 but only after 3 consecutive checks
    expect(result).toBe(0)
    const todoCallCount = (ctx.client.session.todo as ReturnType<typeof mock>).mock.calls.length
    expect(todoCallCount).toBeGreaterThanOrEqual(3)
  })

  it("does not check completion during stabilization period after first meaningful work", async () => {
    //#given - session idle, meaningful work done, but stabilization period not elapsed
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when - abort after 50ms (within the 60ms stabilization period)
    abortAfter(abortController, 50)
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
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    eventState.currentTool = "task"
    const abortController = new AbortController()
    // Virtual clock: abort at virtual 100ms — enough poll cycles to prove the
    // active tool kept blocking completion — without burning real time.
    const clock = createVirtualClock((elapsedMs) => {
      if (elapsedMs >= 100) {
        abortController.abort()
      }
    })

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 500,
      now: clock.now,
      sleep: clock.sleep,
    })

    //#then - should be aborted, not completed (tool blocked exit)
    expect(result).toBe(130)
    const todoCallCount = (ctx.client.session.todo as ReturnType<typeof mock>).mock.calls.length
    expect(todoCallCount).toBe(0)
  })

  it("resets consecutive counter when session becomes busy between checks", async () => {
    //#given - session goes busy on the first check, then idle again ~15ms later
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()
    let todoCallCount = 0
    const busyUntilMs = 15
    // Virtual clock: flip the session idle again once 15ms of virtual time has
    // elapsed, mirroring the old setTimeout(15) but deterministically.
    const clock = createVirtualClock((elapsedMs) => {
      if (elapsedMs >= busyUntilMs) {
        eventState.mainSessionIdle = true
      }
    })

    ;(unsafeTestValue(ctx.client.session)).todo = mock(async () => {
      todoCallCount++
      if (todoCallCount === 1) {
        eventState.mainSessionIdle = false
      }
      return { data: [] }
    })
    ;(unsafeTestValue(ctx.client.session)).children = mock(() =>
      Promise.resolve({ data: [] })
    )
    ;(unsafeTestValue(ctx.client.session)).status = mock(() =>
      Promise.resolve({ data: {} })
    )

    //#when
    const pollIntervalMs = 10
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs,
      requiredConsecutive: 3,
      minStabilizationMs: 10,
      now: clock.now,
      sleep: clock.sleep,
    })

    //#then - completion took longer than the 3-consecutive-poll minimum (30ms)
    //        because the busy window reset the streak. Same causality as the old
    //        elapsedMs>30 check, but on the deterministic virtual clock — the
    //        busy interruption forced at least one extra poll past the minimum.
    expect(result).toBe(0)
    expect(clock.now()).toBeGreaterThan(3 * pollIntervalMs)
  })

  it("returns 1 on session error", async () => {
    //#given
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.mainSessionError = true
    eventState.lastError = "Test error"
    const abortController = new AbortController()
    const clock = createVirtualClock()

    //#when - errors out via the grace cycles well before any stabilization window
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 500,
      now: clock.now,
      sleep: clock.sleep,
    })

    //#then
    expect(result).toBe(1)
  })

  it("returns 130 when aborted", async () => {
    //#given
    const ctx = createMockContext()
    const eventState = createEventState()
    const abortController = new AbortController()

    //#when
    abortAfter(abortController, 50)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then
    expect(result).toBe(130)
  })

  it("does not check completion when hasReceivedMeaningfulWork is false", async () => {
    //#given
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()

    //#when
    abortAfter(abortController, 100)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then
    expect(result).toBe(130)
    const todoCallCount = (ctx.client.session.todo as ReturnType<typeof mock>).mock.calls.length
    expect(todoCallCount).toBe(0)
  })

  it("falls back to session.status API when idle event is missing", async () => {
    //#given - mainSessionIdle not set by events, but status API says idle
    const ctx = createMockContext({
      statuses: {
        "test-session": { type: "idle" },
      },
    })
    const eventState = createEventState()
    eventState.mainSessionIdle = false
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 2,
      minStabilizationMs: 10,
    })

    //#then - completion succeeds without idle event
    expect(result).toBe(0)
  })

  it("treats missing main session status as idle when status API omits idle sessions", async () => {
    //#given - latest opencode omits idle sessions from the status map
    const ctx = createMockContext({
      statuses: {},
    })
    const eventState = createEventState()
    eventState.mainSessionIdle = false
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 2,
      minStabilizationMs: 10,
    })

    //#then - missing entry is treated as idle instead of hanging forever
    expect(result).toBe(0)
  })

  it("rethrows non-Error status API failures instead of treating them as unknown status", async () => {
    //#given
    const thrown = Object.freeze({ reason: "status unavailable" })
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = false
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()
    ;(unsafeTestValue(ctx.client.session)).status = mock(async () => {
      throw thrown
    })

    //#when & then
    abortAfter(abortController, 50)
    await expect(pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 5,
      requiredConsecutive: 1,
      minStabilizationMs: 10,
    })).rejects.toBe(thrown)
  })

  it("allows silent completion after stabilization when no meaningful work is received", async () => {
    //#given - session is idle and stable but no assistant message/tool event arrived
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 1,
      minStabilizationMs: 30,
    })

    //#then - completion succeeds after stabilization window
    expect(result).toBe(0)
  })

  it("uses default stabilization to avoid indefinite wait when no meaningful work arrives", async () => {
    //#given - idle with no meaningful work and no explicit minStabilization override
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 1,
    })

    //#then - command exits without manual Ctrl+C
    expect(result).toBe(0)
  })

  it("coerces non-positive stabilization values to default stabilization", async () => {
    //#given - explicit zero stabilization should still wait for the default window
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()
    // Virtual clock: abort at virtual 100ms — well before the coerced 1000ms
    // default window — so completion must NOT have happened by then.
    const clock = createVirtualClock((elapsedMs) => {
      if (elapsedMs >= 100) {
        abortController.abort()
      }
    })

    //#when - minStabilizationMs:0 must coerce to the 1000ms default, so aborting
    //        at virtual 100ms means the run has not completed early
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 1,
      minStabilizationMs: 0,
      now: clock.now,
      sleep: clock.sleep,
    })

    //#then - should not complete early (0 coerced to the default 1000ms window)
    expect(result).toBe(130)
  })

  it("simulates race condition: brief idle with 0 todos does not cause immediate exit", async () => {
    //#given - simulate Sisyphus outputting text, session goes idle briefly, then tool fires
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()
    let pollTick = 0

    ;(unsafeTestValue(ctx.client.session)).todo = mock(async () => {
      pollTick++
      if (pollTick === 2) {
        eventState.currentTool = "task"
      }
      return { data: [] }
    })
    ;(unsafeTestValue(ctx.client.session)).children = mock(() =>
      Promise.resolve({ data: [] })
    )
    ;(unsafeTestValue(ctx.client.session)).status = mock(() =>
      Promise.resolve({ data: {} })
    )

    //#when - abort after tool stays in-flight
    abortAfter(abortController, 200)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then - should NOT have exited with 0 (tool blocked it, then aborted)
    expect(result).toBe(130)
  })

  it("returns 1 when session errors while not idle (error not masked by idle gate)", async () => {
    //#given - mainSessionIdle=false, mainSessionError=true, lastError="crash"
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
    expect(errorCalls.some((call: unknown[]) => String(call[0] ?? "").includes("Session ended with error"))).toBe(true)
  })

  it("returns 1 when session errors while tool is active (error not masked by tool gate)", async () => {
    //#given - mainSessionIdle=true, currentTool="bash", mainSessionError=true
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

  it("clears the error latch and completes when the session retries after an error (runtime fallback in flight)", async () => {
    //#given - quota error latched, live status reports 'retry' then the session recovers to idle
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.mainSessionError = true
    eventState.lastError = "kimi usage limit reached"
    eventState.hasReceivedMeaningfulWork = true
    let statusCalls = 0
    ;(unsafeTestValue(ctx.client.session)).status = mock(async () => {
      statusCalls++
      if (statusCalls <= 3) {
        return { data: { "test-session": { type: "retry" } } }
      }
      return { data: { "test-session": { type: "idle" } } }
    })
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 1,
      minStabilizationMs: 10,
    })

    //#then - fallback recovery resumed the session; run completes instead of exiting 1
    expect(result).toBe(0)
    expect(eventState.mainSessionError).toBe(false)
  })

  it("does not exit 1 while the session is busy again after an error (fallback dispatch rearmed the session)", async () => {
    //#given - error latched but live status reports the session is busy again
    const ctx = createMockContext({
      statuses: { "test-session": { type: "busy" } },
    })
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.mainSessionError = true
    eventState.lastError = "quota error"
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when - poll well past ERROR_GRACE_CYCLES, then abort
    abortAfter(abortController, 100)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then - aborted by the test (130), not terminated with exit 1
    expect(result).toBe(130)
    expect(eventState.mainSessionError).toBe(false)
  })

  it("returns 1 when CLI run requires meaningful work but the prompt never produces output", async () => {
    //#given
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.mainSessionStarted = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 5,
      requiredConsecutive: 1,
      minStabilizationMs: 1,
      secondaryMeaningfulWorkTimeoutMs: 10,
      requireMeaningfulWork: true,
    })

    //#then
    expect(result).toBe(1)
    const errorCalls = (console.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.some((call: unknown[]) =>
      String(call[0] ?? "").includes("Session never produced assistant output")
    )).toBe(true)
  })

  it("keeps waiting when meaningful work is required and active child work exists", async () => {
    //#given
    const ctx = createMockContext({
      childrenBySession: {
        "test-session": [{ id: "child-session" }],
        "child-session": [],
      },
    })
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.mainSessionStarted = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()

    //#when
    abortAfter(abortController, 50)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 5,
      requiredConsecutive: 1,
      minStabilizationMs: 1,
      secondaryMeaningfulWorkTimeoutMs: 10,
      requireMeaningfulWork: true,
    })

    //#then
    expect(result).toBe(130)
  })

})
