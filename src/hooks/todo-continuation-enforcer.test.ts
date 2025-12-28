import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"

import { createTodoContinuationEnforcer } from "./todo-continuation-enforcer"
import { setMainSession } from "../features/claude-code-session-state"
import type { BackgroundManager } from "../features/background-agent"

describe("todo-continuation-enforcer", () => {
  let promptCalls: Array<{ sessionID: string; agent?: string; text: string }>
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
  })

  afterEach(() => {
    setMainSession(undefined)
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

  test("should skip injection after recent error", async () => {
    // #given - session that just had an error
    const sessionID = "main-error"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session error occurs
    await hook.handler({
      event: { type: "session.error", properties: { sessionID, error: new Error("test") } },
    })

    // #when - session goes idle immediately after
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 3000))

    // #then - no continuation injected (error cooldown)
    expect(promptCalls).toHaveLength(0)
  })

  test("should clear error state on user message and allow injection", async () => {
    // #given - session with error, then user clears it
    const sessionID = "main-error-clear"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - error occurs
    await hook.handler({
      event: { type: "session.error", properties: { sessionID } },
    })

    // #when - user sends message (clears error immediately)
    await hook.handler({
      event: { type: "message.updated", properties: { info: { sessionID, role: "user" } } },
    })

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    await new Promise(r => setTimeout(r, 2500))

    // #then - continuation injected (error was cleared by user message)
    expect(promptCalls.length).toBe(1)
  })

  test("should cancel countdown on user message", async () => {
    // #given - session starting countdown
    const sessionID = "main-cancel"
    setMainSession(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    // #when - session goes idle
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // #when - user sends message immediately (before 2s countdown)
    await hook.handler({
      event: { 
        type: "message.updated", 
        properties: { info: { sessionID, role: "user" } } 
      },
    })

    // #then - wait past countdown time and verify no injection
    await new Promise(r => setTimeout(r, 2500))
    expect(promptCalls).toHaveLength(0)
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
    await new Promise(r => setTimeout(r, 2500))

    // #then - first injection happened
    expect(promptCalls.length).toBe(1)

    // #when - immediately trigger second idle (no 10s wait needed)
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await new Promise(r => setTimeout(r, 2500))

    // #then - second injection also happened (no throttle blocking)
    expect(promptCalls.length).toBe(2)
  }, { timeout: 10000 })
})
