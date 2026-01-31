import { describe, expect, test } from "bun:test"
import { createStopContinuationGuardHook } from "./index"

describe("stop-continuation-guard", () => {
  function createMockPluginInput() {
    return {
      client: {
        tui: {
          showToast: async () => ({}),
        },
      },
      directory: "/tmp/test",
    } as never
  }

  test("should mark session as stopped", () => {
    // #given - a guard hook with no stopped sessions
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    const sessionID = "test-session-1"

    // #when - we stop continuation for the session
    guard.stop(sessionID)

    // #then - session should be marked as stopped
    expect(guard.isStopped(sessionID)).toBe(true)
  })

  test("should return false for non-stopped sessions", () => {
    // #given - a guard hook with no stopped sessions
    const guard = createStopContinuationGuardHook(createMockPluginInput())

    // #when - we check a session that was never stopped

    // #then - it should return false
    expect(guard.isStopped("non-existent-session")).toBe(false)
  })

  test("should clear stopped state for a session", () => {
    // #given - a session that was stopped
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    const sessionID = "test-session-2"
    guard.stop(sessionID)

    // #when - we clear the session
    guard.clear(sessionID)

    // #then - session should no longer be stopped
    expect(guard.isStopped(sessionID)).toBe(false)
  })

  test("should handle multiple sessions independently", () => {
    // #given - multiple sessions with different stop states
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    const session1 = "session-1"
    const session2 = "session-2"
    const session3 = "session-3"

    // #when - we stop some sessions but not others
    guard.stop(session1)
    guard.stop(session2)

    // #then - each session has its own state
    expect(guard.isStopped(session1)).toBe(true)
    expect(guard.isStopped(session2)).toBe(true)
    expect(guard.isStopped(session3)).toBe(false)
  })

  test("should clear session on session.deleted event", async () => {
    // #given - a session that was stopped
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    const sessionID = "test-session-3"
    guard.stop(sessionID)

    // #when - session is deleted
    await guard.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
      },
    })

    // #then - session should no longer be stopped (cleaned up)
    expect(guard.isStopped(sessionID)).toBe(false)
  })

  test("should not affect other sessions on session.deleted", async () => {
    // #given - multiple stopped sessions
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    const session1 = "session-keep"
    const session2 = "session-delete"
    guard.stop(session1)
    guard.stop(session2)

    // #when - one session is deleted
    await guard.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: session2 } },
      },
    })

    // #then - other session should remain stopped
    expect(guard.isStopped(session1)).toBe(true)
    expect(guard.isStopped(session2)).toBe(false)
  })

  test("should clear stopped state on new user message (chat.message)", async () => {
    // #given - a session that was stopped
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    const sessionID = "test-session-4"
    guard.stop(sessionID)
    expect(guard.isStopped(sessionID)).toBe(true)

    // #when - user sends a new message
    await guard["chat.message"]({ sessionID })

    // #then - stop state should be cleared (one-time only)
    expect(guard.isStopped(sessionID)).toBe(false)
  })

  test("should not affect non-stopped sessions on chat.message", async () => {
    // #given - a session that was never stopped
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    const sessionID = "test-session-5"

    // #when - user sends a message (session was never stopped)
    await guard["chat.message"]({ sessionID })

    // #then - should not throw and session remains not stopped
    expect(guard.isStopped(sessionID)).toBe(false)
  })

  test("should handle undefined sessionID in chat.message", async () => {
    // #given - a guard with a stopped session
    const guard = createStopContinuationGuardHook(createMockPluginInput())
    guard.stop("some-session")

    // #when - chat.message is called without sessionID
    await guard["chat.message"]({ sessionID: undefined })

    // #then - should not throw and stopped session remains stopped
    expect(guard.isStopped("some-session")).toBe(true)
  })
})
