import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { BackgroundManager } from "../features/background-agent"
import { setMainSession, subagentSessions } from "../features/claude-code-session-state"
import { createTodoContinuationEnforcer } from "./todo-continuation-enforcer"

describe("todo-continuation-enforcer", () => {
  let promptCalls: Array<{ sessionID: string; agent?: string; model?: { providerID?: string; modelID?: string }; text: string }>
  let toastCalls: Array<{ title: string; message: string }>

  interface MockMessage {
    info: {
      id: string
      role: "user" | "assistant"
      error?: { name: string; data?: { message: string } }
    }
  }

  let mockMessages: MockMessage[] = []

  function createMockPluginInput() {
    return {
      client: {
        session: {
          todo: async () => ({ data: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
            { id: "2", content: "Task 2", status: "completed", priority: "medium" },
          ]}),
          messages: async () => ({ data: mockMessages }),
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
    mockMessages = []
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

  test("should accept skipAgents option without error", async () => {
    // #given - session with skipAgents configured for Prometheus
    const sessionID = "main-prometheus-option"
    setMainSession(sessionID)

    // #when - create hook with skipAgents option (should not throw)
    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {
      skipAgents: ["Prometheus (Planner)", "custom-agent"],
    })

    // #then - handler works without error
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 100))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
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





  // ============================================================
  // API-BASED ABORT DETECTION TESTS
  // These tests verify that abort is detected by checking
  // the last assistant message's error field via session.messages API
  // ============================================================

  test("should skip injection when last assistant message has MessageAbortedError", async () => {
    // #given - session where last assistant message was aborted
    const sessionID = "main-api-abort"
    setMainSession(sessionID)

    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant", error: { name: "MessageAbortedError", data: { message: "The operation was aborted" } } } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation (last message was aborted)
    expect(promptCalls).toHaveLength(0)
  })

  test("should inject when last assistant message has no error", async () => {
    // #given - session where last assistant message completed normally
    const sessionID = "main-api-no-error"
    setMainSession(sessionID)

    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - continuation injected (no abort)
    expect(promptCalls.length).toBe(1)
  })

  test("should inject when last message is from user (not assistant)", async () => {
    // #given - session where last message is from user
    const sessionID = "main-api-user-last"
    setMainSession(sessionID)

    mockMessages = [
      { info: { id: "msg-1", role: "assistant" } },
      { info: { id: "msg-2", role: "user" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - continuation injected (last message is user, not aborted assistant)
    expect(promptCalls.length).toBe(1)
  })

  test("should skip when last assistant message has any abort-like error", async () => {
    // #given - session where last assistant message has AbortError (DOMException style)
    const sessionID = "main-api-abort-dom"
    setMainSession(sessionID)

    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant", error: { name: "AbortError" } } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation (abort error detected)
    expect(promptCalls).toHaveLength(0)
  })

  test("should skip injection when abort detected via session.error event (event-based, primary)", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-event-abort"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error event fires
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // #when - session goes idle immediately after
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation (abort detected via event)
    expect(promptCalls).toHaveLength(0)
  })

  test("should skip injection when AbortError detected via session.error event", async () => {
    // #given - session with incomplete todos
    const sessionID = "main-event-abort-dom"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - AbortError event fires
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "AbortError" } },
      },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation (abort detected via event)
    expect(promptCalls).toHaveLength(0)
  })

  test("should inject when abort flag is stale (>3s old)", async () => {
    // #given - session with incomplete todos and old abort timestamp
    const sessionID = "main-stale-abort"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error fires
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // #when - wait >3s then idle fires
    await new Promise(r => setTimeout(r, 3100))

    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - continuation injected (abort flag is stale)
    expect(promptCalls.length).toBeGreaterThan(0)
  }, 10000)

  test("should clear abort flag on user message activity", async () => {
    // #given - session with abort detected
    const sessionID = "main-clear-on-user"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error fires
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // #when - user sends new message (clears abort flag)
    await new Promise(r => setTimeout(r, 600))
    await hook.handler({
      event: {
        type: "message.updated",
        properties: { info: { sessionID, role: "user" } },
      },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - continuation injected (abort flag was cleared by user activity)
    expect(promptCalls.length).toBeGreaterThan(0)
  })

  test("should clear abort flag on assistant message activity", async () => {
    // #given - session with abort detected
    const sessionID = "main-clear-on-assistant"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error fires
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // #when - assistant starts responding (clears abort flag)
    await hook.handler({
      event: {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant" } },
      },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - continuation injected (abort flag was cleared by assistant activity)
    expect(promptCalls.length).toBeGreaterThan(0)
  })

  test("should clear abort flag on tool execution", async () => {
    // #given - session with abort detected
    const sessionID = "main-clear-on-tool"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error fires
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // #when - tool executes (clears abort flag)
    await hook.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID },
      },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - continuation injected (abort flag was cleared by tool execution)
    expect(promptCalls.length).toBeGreaterThan(0)
  })

  test("should use event-based detection even when API indicates no abort (event wins)", async () => {
    // #given - session with abort event but API shows no error
    const sessionID = "main-event-wins"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - abort error event fires (but API doesn't have it yet)
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation (event-based detection wins over API)
    expect(promptCalls).toHaveLength(0)
  })

  test("should use API fallback when event is missed but API shows abort", async () => {
    // #given - session where event was missed but API shows abort
    const sessionID = "main-api-fallback"
    setMainSession(sessionID)
    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant", error: { name: "MessageAbortedError" } } },
    ]

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle without prior session.error event
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation (API fallback detected the abort)
    expect(promptCalls).toHaveLength(0)
  })
})
