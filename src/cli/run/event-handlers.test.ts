import { describe, it, expect } from "bun:test"
import type { RunContext } from "./types"
import { createEventState } from "./events"
import { handleSessionStatus } from "./event-handlers"

const createMockContext = (sessionID: string = "test-session"): RunContext => ({
  sessionID,
} as RunContext)

describe("handleSessionStatus", () => {
  it("recognizes idle from session.status event (not just deprecated session.idle)", () => {
    //#given - state with mainSessionIdle=false
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = false

    const payload = {
      type: "session.status",
      properties: {
        sessionID: "test-session",
        status: { type: "idle" as const },
      },
    }

    //#when - handleSessionStatus called with idle status
    handleSessionStatus(ctx, payload as any, state)

    //#then - state.mainSessionIdle === true
    expect(state.mainSessionIdle).toBe(true)
  })

  it("handleSessionStatus sets idle=false on busy", () => {
    //#given - state with mainSessionIdle=true
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = true

    const payload = {
      type: "session.status",
      properties: {
        sessionID: "test-session",
        status: { type: "busy" as const },
      },
    }

    //#when - handleSessionStatus called with busy status
    handleSessionStatus(ctx, payload as any, state)

    //#then - state.mainSessionIdle === false
    expect(state.mainSessionIdle).toBe(false)
  })

  it("does nothing for different session ID", () => {
    //#given - state with mainSessionIdle=true
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = true

    const payload = {
      type: "session.status",
      properties: {
        sessionID: "other-session",
        status: { type: "idle" as const },
      },
    }

    //#when - handleSessionStatus called with different session ID
    handleSessionStatus(ctx, payload as any, state)

    //#then - state.mainSessionIdle remains unchanged
    expect(state.mainSessionIdle).toBe(true)
  })
})
