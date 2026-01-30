import { describe, it, expect } from "bun:test"
import { createEventState, serializeError, type EventState } from "./events"
import type { RunContext, EventPayload } from "./types"

const createMockContext = (sessionID: string = "test-session"): RunContext => ({
  client: {} as RunContext["client"],
  sessionID,
  directory: "/test",
  abortController: new AbortController(),
})

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item
  }
}

describe("serializeError", () => {
  it("returns 'Unknown error' for null/undefined", () => {
    // #given / #when / #then
    expect(serializeError(null)).toBe("Unknown error")
    expect(serializeError(undefined)).toBe("Unknown error")
  })

  it("returns message from Error instance", () => {
    // #given
    const error = new Error("Something went wrong")

    // #when / #then
    expect(serializeError(error)).toBe("Something went wrong")
  })

  it("returns string as-is", () => {
    // #given / #when / #then
    expect(serializeError("Direct error message")).toBe("Direct error message")
  })

  it("extracts message from plain object", () => {
    // #given
    const errorObj = { message: "Object error message", code: "ERR_001" }

    // #when / #then
    expect(serializeError(errorObj)).toBe("Object error message")
  })

  it("extracts message from nested error object", () => {
    // #given
    const errorObj = { error: { message: "Nested error message" } }

    // #when / #then
    expect(serializeError(errorObj)).toBe("Nested error message")
  })

  it("extracts message from data.message path", () => {
    // #given
    const errorObj = { data: { message: "Data error message" } }

    // #when / #then
    expect(serializeError(errorObj)).toBe("Data error message")
  })

  it("JSON stringifies object without message property", () => {
    // #given
    const errorObj = { code: "ERR_001", status: 500 }

    // #when
    const result = serializeError(errorObj)

    // #then
    expect(result).toContain("ERR_001")
    expect(result).toContain("500")
  })
})

describe("createEventState", () => {
  it("creates initial state with correct defaults", () => {
    // #given / #when
    const state = createEventState()

    // #then
    expect(state.mainSessionIdle).toBe(false)
    expect(state.lastOutput).toBe("")
    expect(state.lastPartText).toBe("")
    expect(state.currentTool).toBe(null)
    expect(state.hasReceivedMeaningfulWork).toBe(false)
  })
})

describe("event handling", () => {
  it("session.idle sets mainSessionIdle to true for matching session", async () => {
    // #given
    const ctx = createMockContext("my-session")
    const state = createEventState()

    const payload: EventPayload = {
      type: "session.idle",
      properties: { sessionID: "my-session" },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then
    expect(state.mainSessionIdle).toBe(true)
  })

  it("session.idle does not affect state for different session", async () => {
    // #given
    const ctx = createMockContext("my-session")
    const state = createEventState()

    const payload: EventPayload = {
      type: "session.idle",
      properties: { sessionID: "other-session" },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then
    expect(state.mainSessionIdle).toBe(false)
  })

  it("hasReceivedMeaningfulWork is false initially after session.idle", async () => {
    // #given - session goes idle without any assistant output (race condition scenario)
    const ctx = createMockContext("my-session")
    const state = createEventState()

    const payload: EventPayload = {
      type: "session.idle",
      properties: { sessionID: "my-session" },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then - idle but no meaningful work yet
    expect(state.mainSessionIdle).toBe(true)
    expect(state.hasReceivedMeaningfulWork).toBe(false)
  })

  it("message.updated with assistant role sets hasReceivedMeaningfulWork", async () => {
    // #given
    const ctx = createMockContext("my-session")
    const state = createEventState()

    const payload: EventPayload = {
      type: "message.updated",
      properties: {
        info: { sessionID: "my-session", role: "assistant" },
      },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then
    expect(state.hasReceivedMeaningfulWork).toBe(true)
  })

  it("message.updated with user role does not set hasReceivedMeaningfulWork", async () => {
    // #given - user message should not count as meaningful work
    const ctx = createMockContext("my-session")
    const state = createEventState()

    const payload: EventPayload = {
      type: "message.updated",
      properties: {
        info: { sessionID: "my-session", role: "user" },
      },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then - user role should not count as meaningful work
    expect(state.hasReceivedMeaningfulWork).toBe(false)
  })

  it("tool.execute sets hasReceivedMeaningfulWork", async () => {
    // #given
    const ctx = createMockContext("my-session")
    const state = createEventState()

    const payload: EventPayload = {
      type: "tool.execute",
      properties: {
        sessionID: "my-session",
        name: "read_file",
        input: { filePath: "/src/index.ts" },
      },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then
    expect(state.hasReceivedMeaningfulWork).toBe(true)
  })

  it("tool.execute from different session does not set hasReceivedMeaningfulWork", async () => {
    // #given
    const ctx = createMockContext("my-session")
    const state = createEventState()

    const payload: EventPayload = {
      type: "tool.execute",
      properties: {
        sessionID: "other-session",
        name: "read_file",
        input: { filePath: "/src/index.ts" },
      },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then - different session's tool call shouldn't count
    expect(state.hasReceivedMeaningfulWork).toBe(false)
  })

  it("session.status with busy type sets mainSessionIdle to false", async () => {
    // #given
    const ctx = createMockContext("my-session")
    const state: EventState = {
      mainSessionIdle: true,
      mainSessionError: false,
      lastError: null,
      lastOutput: "",
      lastPartText: "",
      currentTool: null,
      hasReceivedMeaningfulWork: false,
    }

    const payload: EventPayload = {
      type: "session.status",
      properties: { sessionID: "my-session", status: { type: "busy" } },
    }

    const events = toAsyncIterable([payload])
    const { processEvents } = await import("./events")

    // #when
    await processEvents(ctx, events, state)

    // #then
    expect(state.mainSessionIdle).toBe(false)
  })
})
