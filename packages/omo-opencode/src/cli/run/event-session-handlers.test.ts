/// <reference path="../../../../../bun-test.d.ts" />
/// <reference types="bun-types" />
import { describe, expect, it, spyOn } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createEventState } from "./events"
import { handleSessionError, handleSessionStatus } from "./event-handlers"
import { createMockContext } from "./event-handler-test-support.test"

describe("handleSessionStatus", () => {
  it("recognizes idle from session.status event (not just deprecated session.idle)", () => {
    //#given
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

    //#when
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionIdle).toBe(true)
  })

  it("sets idle=false on busy", () => {
    //#given
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

    //#when
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionIdle).toBe(false)
    expect(state.mainSessionStarted).toBe(true)
  })

  it("does nothing for different session ID", () => {
    //#given
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

    //#when
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionIdle).toBe(true)
  })

  it("recognizes idle from camelCase sessionId", () => {
    //#given
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = false

    const payload = {
      type: "session.status",
      properties: {
        sessionId: "test-session",
        status: { type: "idle" as const },
      },
    }

    //#when
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionIdle).toBe(true)
  })
})

describe("handleSessionError", () => {
  it("records and prints matching session errors", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})

    const payload = {
      type: "session.error",
      properties: {
        sessionID: "ses_main",
        error: { message: "Provider timed out" },
      },
    }

    //#when
    handleSessionError(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(true)
    expect(state.lastError).toBe("Provider timed out")
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it("ignores errors from other sessions", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})

    const payload = {
      type: "session.error",
      properties: {
        sessionID: "ses_other",
        error: { message: "Other session failed" },
      },
    }

    //#when
    handleSessionError(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(false)
    expect(state.lastError).toBe(null)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
