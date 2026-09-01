/// <reference path="../../../../../bun-test.d.ts" />
/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createEventState } from "./events"
import { handleTuiToast } from "./event-handlers"
import { createMockContext } from "./event-handler-test-support.test"

describe("handleTuiToast", () => {
  it("marks main session as error when toast variant is error", () => {
    //#given
    const ctx = createMockContext("test-session")
    const state = createEventState()

    const payload = {
      type: "tui.toast.show",
      properties: {
        title: "Auth",
        message: "Invalid API key",
        variant: "error" as const,
      },
    }

    //#when
    handleTuiToast(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(true)
    expect(state.lastError).toBe("Auth: Invalid API key")
  })

  it("does not mark session error for warning toast", () => {
    //#given
    const ctx = createMockContext("test-session")
    const state = createEventState()

    const payload = {
      type: "tui.toast.show",
      properties: {
        message: "Retrying provider",
        variant: "warning" as const,
      },
    }

    //#when
    handleTuiToast(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(false)
    expect(state.lastError).toBe(null)
  })
})
