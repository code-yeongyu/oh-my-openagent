/// <reference path="../../../bun-test.d.ts" />
import { describe, expect, it, spyOn } from "bun:test"
import { createEventState, processEvents } from "./events"
import * as facadeHandlers from "./event-handlers"
import * as messageHandlers from "./event-message-handlers"
import * as sessionHandlers from "./event-session-handlers"
import { createMockContext } from "./event-handler-test-support.test"
import * as toastHandlers from "./event-toast-handlers"
import * as toolHandlers from "./event-tool-handlers"

async function* toAsyncIterable(items: readonly unknown[]): AsyncIterable<unknown> {
  for (const item of items) {
    yield item
  }
}

describe("event-handlers facade", () => {
  it("re-exports the concrete handler modules", () => {
    //#given / #when / #then
    expect(facadeHandlers.handleSessionError).toBe(sessionHandlers.handleSessionError)
    expect(facadeHandlers.handleSessionIdle).toBe(sessionHandlers.handleSessionIdle)
    expect(facadeHandlers.handleSessionStatus).toBe(sessionHandlers.handleSessionStatus)
    expect(facadeHandlers.handleMessagePartDelta).toBe(messageHandlers.handleMessagePartDelta)
    expect(facadeHandlers.handleMessagePartUpdated).toBe(messageHandlers.handleMessagePartUpdated)
    expect(facadeHandlers.handleMessageUpdated).toBe(messageHandlers.handleMessageUpdated)
    expect(facadeHandlers.handleToolExecute).toBe(toolHandlers.handleToolExecute)
    expect(facadeHandlers.handleToolResult).toBe(toolHandlers.handleToolResult)
    expect(facadeHandlers.handleTuiToast).toBe(toastHandlers.handleTuiToast)
    expect(facadeHandlers.eventHandlers).toEqual([
      sessionHandlers.handleSessionError,
      sessionHandlers.handleSessionIdle,
      sessionHandlers.handleSessionStatus,
      messageHandlers.handleMessagePartUpdated,
      messageHandlers.handleMessagePartDelta,
      messageHandlers.handleMessageUpdated,
      toolHandlers.handleToolExecute,
      toolHandlers.handleToolResult,
      toastHandlers.handleTuiToast,
    ])
  })

  it("preserves routed event behavior through processEvents", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})
    const events = toAsyncIterable([
      {
        type: "session.status",
        properties: {
          sessionID: "ses_main",
          status: { type: "busy" },
        },
      },
      {
        type: "session.idle",
        properties: { sessionID: "other-session" },
      },
      {
        type: "tui.toast.show",
        properties: {
          title: "Auth",
          message: "Invalid API key",
          variant: "error",
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "ses_main",
          status: { type: "idle" },
        },
      },
    ])

    try {
      //#when
      await processEvents(ctx, events, state)

      //#then
      expect(state.mainSessionStarted).toBe(true)
      expect(state.mainSessionIdle).toBe(true)
      expect(state.mainSessionError).toBe(true)
      expect(state.lastError).toBe("Auth: Invalid API key")
      expect(state.hasReceivedMeaningfulWork).toBe(false)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
