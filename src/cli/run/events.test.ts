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
