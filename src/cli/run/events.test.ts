import { describe, it, expect } from "bun:test"
import { createEventState, type EventState } from "./events"
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
