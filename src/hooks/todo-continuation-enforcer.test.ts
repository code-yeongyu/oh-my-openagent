import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { BackgroundManager } from "../features/background-agent"
import { setMainSession, subagentSessions } from "../features/claude-code-session-state"
import { createTodoContinuationEnforcer } from "./todo-continuation-enforcer"

describe("todo-continuation-enforcer", () => {
  let promptCalls: Array<{ sessionID: string; agent?: string; model?: { providerID?: string; modelID?: string }; text: string }>
  let toastCalls: Array<{ title: string; message: string }>

  function createMockPluginInput() {
    return {
      client: {
        session: {
          todo: async () => ({ data: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
            { id: "2", content: "Task 2", status: "completed", priority: "medium" },
          ]}),
          prompt: async (opts: any) => {
            promptCalls.push({
              sessionID: opts.path.id,
              agent: opts.body.agent,
              model: opts.body.model,
              text: opts.body.parts[0].text,
            })
            return {}
          },
        },
        tui: {
          showToast: async (opts: any) => {
            toastCalls.push({
              title: opts.body.title,
              message: opts.body.message,
            })
            return {}
          },
        },
      },
      directory: "/tmp/test",
    } as any
  }

  function createMockBackgroundManager(runningTasks: boolean = false): BackgroundManager {
    return {
      getTasksByParentSession: () => runningTasks
        ? [{ status: "running" }]
        : [],
    } as any
  }

  beforeEach(() => {
    promptCalls = []
    toastCalls = []
    setMainSession(undefined)
    subagentSessions.clear()
  })

  afterEach(() => {
    setMainSession(undefined)
    subagentSessions.clear()
  })

  test("should inject continuation when idle with incomplete todos", async () => {
    // #given - main session with incomplete todos
    const sessionID = "main-123"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {
      backgroundManager: createMockBackgroundManager(false),
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #then - countdown toast shown
    await new Promise(r => setTimeout(r, 100))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    expect(toastCalls[0].title).toBe("Todo Continuation")

    // #then - after countdown, continuation injected
    await new Promise(r => setTimeout(r, 2500))
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].text).toContain("TODO CONTINUATION")
  })

  test("should not inject when all todos are complete", async () => {
    // #given - session with all todos complete
    const sessionID = "main-456"
    setMainSession(sessionID)

    const mockInput = createMockPluginInput()
    mockInput.client.session.todo = async () => ({ data: [
      { id: "1", content: "Task 1", status: "completed", priority: "high" },
    ]})

    const hook = createTodoContinuationEnforcer(mockInput, {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected
    expect(promptCalls).toHaveLength(0)
  })

  test("should not inject when background tasks are running", async () => {
    // #given - session with running background tasks
    const sessionID = "main-789"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {
      backgroundManager: createMockBackgroundManager(true),
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected
    expect(promptCalls).toHaveLength(0)
  })

  test("should not inject for non-main session", async () => {
    // #given - main session set, different session goes idle
    setMainSession("main-session")
    const otherSession = "other-session"

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - non-main session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID: otherSession } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected
    expect(promptCalls).toHaveLength(0)
  })

  test("should inject for background task session (subagent)", async () => {
    // #given - main session set, background task session registered
    setMainSession("main-session")
    const bgTaskSession = "bg-task-session"
    subagentSessions.add(bgTaskSession)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - background task session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID: bgTaskSession } },
    })

    // #then - continuation injected for background task session
    await new Promise(r => setTimeout(r, 2500))
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe(bgTaskSession)
  })

  test("should skip injection when abort error occurs immediately before idle", async () => {
    // #given - session that just had an abort error
    const sessionID = "main-error"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error occurs
    await hook.handler({
      event: { type: "session.error", properties: { sessionID, error: { name: "AbortError", message: "aborted" } } },
    })

    // #when - session goes idle immediately after abort
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected (abort was immediately before idle)
    expect(promptCalls).toHaveLength(0)
  })

  test("should clear abort state on user message and allow injection", async () => {
    // #given - session with abort error, then user clears it
    const sessionID = "main-error-clear"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error occurs
    await hook.handler({
      event: { type: "session.error", properties: { sessionID, error: { message: "aborted" } } },
    })

    // #when - user sends message (clears abort state)
    await hook.handler({
      event: { type: "message.updated", properties: { info: { sessionID, role: "user" } } },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 2500))

    // #then - continuation injected (abort state was cleared by user message)
    expect(promptCalls.length).toBe(1)
  })

  test("should cancel countdown on user message after grace period", async () => {
    // #given - session starting countdown
    const sessionID = "main-cancel"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #when - wait past grace period (500ms), then user sends message
    await new Promise(r => setTimeout(r, 600))
    await hook.handler({
      event: {
        type: "message.updated",
        properties: { info: { sessionID, role: "user" } }
      },
    })

    // #then - wait past countdown time and verify no injection (countdown was cancelled)
    await new Promise(r => setTimeout(r, 2500))
    expect(promptCalls).toHaveLength(0)
  })

  test("should ignore user message within grace period", async () => {
    // #given - session starting countdown
    const sessionID = "main-grace"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #when - user message arrives within grace period (immediately)
    await hook.handler({
      event: {
        type: "message.updated",
        properties: { info: { sessionID, role: "user" } }
      },
    })

    // #then - countdown should continue (message was ignored)
    // wait past 2s countdown and verify injection happens
    await new Promise(r => setTimeout(r, 2500))
    expect(promptCalls).toHaveLength(1)
  })

  test("should cancel countdown on assistant activity", async () => {
    // #given - session starting countdown
    const sessionID = "main-assistant"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #when - assistant starts responding
    await new Promise(r => setTimeout(r, 500))
    await hook.handler({
      event: {
        type: "message.part.updated",
        properties: { info: { sessionID, role: "assistant" } }
      },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected (cancelled)
    expect(promptCalls).toHaveLength(0)
  })

  test("should cancel countdown on tool execution", async () => {
    // #given - session starting countdown
    const sessionID = "main-tool"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #when - tool starts executing
    await new Promise(r => setTimeout(r, 500))
    await hook.handler({
      event: { type: "tool.execute.before", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected (cancelled)
    expect(promptCalls).toHaveLength(0)
  })

  test("should skip injection during recovery mode", async () => {
    // #given - session in recovery mode
    const sessionID = "main-recovery"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - mark as recovering
    hook.markRecovering(sessionID)

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected
    expect(promptCalls).toHaveLength(0)
  })

  test("should inject after recovery complete", async () => {
    // #given - session was in recovery, now complete
    const sessionID = "main-recovery-done"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - mark as recovering then complete
    hook.markRecovering(sessionID)
    hook.markRecoveryComplete(sessionID)

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - continuation injected
    expect(promptCalls.length).toBe(1)
  })

  test("should cleanup on session deleted", async () => {
    // #given - session starting countdown
    const sessionID = "main-delete"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #when - session is deleted during countdown
    await new Promise(r => setTimeout(r, 500))
    await hook.handler({
      event: { type: "session.deleted", properties: { info: { id: sessionID } } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected (cleaned up)
    expect(promptCalls).toHaveLength(0)
  })

  test("should show countdown toast updates", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-toast"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #then - multiple toast updates during countdown (2s countdown = 2 toasts: "2s" and "1s")
    await new Promise(r => setTimeout(r, 2500))
    expect(toastCalls.length).toBeGreaterThanOrEqual(2)
    expect(toastCalls[0].message).toContain("2s")
  })

  test("should not have 10s throttle between injections", async () => {
    // #given - new hook instance (no prior state)
    const sessionID = "main-no-throttle"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - first idle cycle completes
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await new Promise(r => setTimeout(r, 3500))

    // #then - first injection happened
    expect(promptCalls.length).toBe(1)

    // #when - immediately trigger second idle (no 10s wait needed)
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await new Promise(r => setTimeout(r, 3500))

    // #then - second injection also happened (no throttle blocking)
    expect(promptCalls.length).toBe(2)
  }, { timeout: 15000 })

  // ============================================================
  // ABORT "IMMEDIATELY BEFORE" DETECTION TESTS
  // These tests verify that abort errors only block continuation
  // when they occur IMMEDIATELY before session.idle, not based
  // on a time-based cooldown.
  // ============================================================

  test("should skip injection ONLY when abort error occurs immediately before idle", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-abort-immediate"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error occurs (with abort-specific error)
    await hook.handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { name: "MessageAbortedError", message: "The operation was aborted" }
        }
      },
    })

    // #when - session goes idle IMMEDIATELY after abort (no other events in between)
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected (abort was immediately before idle)
    expect(promptCalls).toHaveLength(0)
  })

  test("should inject normally when abort error is followed by assistant activity before idle", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-abort-then-assistant"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error occurs
    await hook.handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { name: "MessageAbortedError", message: "The operation was aborted" }
        }
      },
    })

    // #when - assistant sends a message (intervening event clears abort state)
    await hook.handler({
      event: {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant" } }
      },
    })

    // #when - session goes idle (abort is no longer "immediately before")
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 2500))

    // #then - continuation injected (abort was NOT immediately before idle)
    expect(promptCalls.length).toBe(1)
  })

  test("should inject normally when abort error is followed by tool execution before idle", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-abort-then-tool"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error occurs
    await hook.handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { message: "aborted" }
        }
      },
    })

    // #when - tool execution happens (intervening event)
    await hook.handler({
      event: { type: "tool.execute.after", properties: { sessionID } },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 2500))

    // #then - continuation injected (abort was NOT immediately before idle)
    expect(promptCalls.length).toBe(1)
  })

  test("should NOT skip for non-abort errors even if immediately before idle", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-noabort-error"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - non-abort error occurs (e.g., network error, API error)
    await hook.handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { name: "NetworkError", message: "Connection failed" }
        }
      },
    })

    // #when - session goes idle immediately after
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 2500))

    // #then - continuation injected (non-abort errors don't block)
    expect(promptCalls.length).toBe(1)
  })

  test("should inject after abort if time passes and new idle event occurs", async () => {
    // #given - session with incomplete todos, abort happened previously
    const sessionID = "main-abort-time-passed"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error occurs
    await hook.handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { name: "AbortError", message: "cancelled" }
        }
      },
    })

    // #when - first idle (immediately after abort) - should be skipped
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3500))
    expect(promptCalls).toHaveLength(0)

    // #when - second idle event occurs (abort is no longer "immediately before")
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3500))

    // #then - continuation injected on second idle (abort state was consumed)
    expect(promptCalls.length).toBe(1)
  }, { timeout: 15000 })

  test("should handle multiple abort errors correctly - only last one matters", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-multi-abort"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - first abort error
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { message: "aborted" } }
      },
    })

    // #when - second abort error (immediately before idle)
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { message: "interrupted" } }
      },
    })

    // #when - idle immediately after second abort
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation (abort was immediately before)
    expect(promptCalls).toHaveLength(0)
  })
})
