import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"

import { createSessionNotification } from "./session-notification"
import { setMainSession, subagentSessions, _resetForTesting } from "../features/claude-code-session-state"
import * as utils from "./session-notification-utils"

describe("session-notification", () => {
  let notificationCalls: string[]

  function createMockPluginInput() {
    return {
      $: async (cmd: TemplateStringsArray | string, ...values: any[]) => {
        // #given - track notification commands (osascript, notify-send, powershell)
        const cmdStr = typeof cmd === "string" 
          ? cmd 
          : cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
        
        if (cmdStr.includes("osascript") || cmdStr.includes("notify-send") || cmdStr.includes("powershell")) {
          notificationCalls.push(cmdStr)
        }
        return { stdout: "", stderr: "", exitCode: 0 }
      },
      client: {
        session: {
          todo: async () => ({ data: [] }),
        },
      },
      directory: "/tmp/test",
    } as any
  }

  beforeEach(() => {
    _resetForTesting()
    notificationCalls = []
    
    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")
    spyOn(utils, "getNotifySendPath").mockResolvedValue("/usr/bin/notify-send")
    spyOn(utils, "getPowershellPath").mockResolvedValue("powershell")
    spyOn(utils, "getAfplayPath").mockResolvedValue("/usr/bin/afplay")
    spyOn(utils, "getPaplayPath").mockResolvedValue("/usr/bin/paplay")
    spyOn(utils, "getAplayPath").mockResolvedValue("/usr/bin/aplay")
    spyOn(utils, "startBackgroundCheck").mockImplementation(() => {})
  })

  afterEach(() => {
    // #given - cleanup after each test
    subagentSessions.clear()
    setMainSession(undefined)
  })

  test("should not trigger notification for subagent session", async () => {
    // #given - a subagent session exists
    const subagentSessionID = "subagent-123"
    subagentSessions.add(subagentSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // #when - subagent session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // #then - notification should NOT be sent
    expect(notificationCalls).toHaveLength(0)
  })

  test("should not trigger notification when mainSessionID is set and session is not main", async () => {
    // #given - main session is set, but a different session goes idle
    const mainSessionID = "main-123"
    const otherSessionID = "other-456"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // #when - non-main session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: otherSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // #then - notification should NOT be sent
    expect(notificationCalls).toHaveLength(0)
  })

  test("should trigger notification for main session when idle", async () => {
    // #given - main session is set
    const mainSessionID = "main-789"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 10,
      skipIfIncompleteTodos: false,
    })

    // #when - main session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    // Wait for idle confirmation delay + buffer
    await new Promise((resolve) => setTimeout(resolve, 100))

    // #then - notification should be sent
    expect(notificationCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("should skip notification for subagent even when mainSessionID is set", async () => {
    // #given - both mainSessionID and subagent session exist
    const mainSessionID = "main-999"
    const subagentSessionID = "subagent-888"
    setMainSession(mainSessionID)
    subagentSessions.add(subagentSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // #when - subagent session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // #then - notification should NOT be sent (subagent check takes priority)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should handle subagentSessions and mainSessionID checks in correct order", async () => {
    // #given - main session and subagent session exist
    const mainSessionID = "main-111"
    const subagentSessionID = "subagent-222"
    const unknownSessionID = "unknown-333"
    setMainSession(mainSessionID)
    subagentSessions.add(subagentSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // #when - subagent session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    // #when - unknown session goes idle (not main, not in subagentSessions)
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: unknownSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // #then - no notifications (subagent blocked by subagentSessions, unknown blocked by mainSessionID check)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should cancel pending notification on session activity", async () => {
    // #given - main session is set
    const mainSessionID = "main-cancel"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 100, // Long delay
      skipIfIncompleteTodos: false,
    })

    // #when - session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    // #when - activity happens before delay completes
    await hook({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: mainSessionID },
      },
    })

    // Wait for original delay to pass
    await new Promise((resolve) => setTimeout(resolve, 150))

    // #then - notification should NOT be sent (cancelled by activity)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should handle session.created event without notification", async () => {
    // #given - a new session is created
    const hook = createSessionNotification(createMockPluginInput(), {})

    // #when - session.created event fires
    await hook({
      event: {
        type: "session.created",
        properties: {
          info: { id: "new-session", title: "Test Session" },
        },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // #then - no notification should be triggered
    expect(notificationCalls).toHaveLength(0)
  })

  test("should handle session.deleted event and cleanup state", async () => {
    // #given - a session exists
    const hook = createSessionNotification(createMockPluginInput(), {})

    // #when - session.deleted event fires
    await hook({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "deleted-session" },
        },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // #then - no notification should be triggered
    expect(notificationCalls).toHaveLength(0)
  })

  test("should mark session activity on message.updated event", async () => {
    // #given - main session is set
    const mainSessionID = "main-message"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 50,
      skipIfIncompleteTodos: false,
    })

    // #when - session goes idle, then message.updated fires
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    await hook({
      event: {
        type: "message.updated",
        properties: {
          info: { sessionID: mainSessionID, role: "user", finish: false },
        },
      },
    })

    // Wait for idle delay to pass
    await new Promise((resolve) => setTimeout(resolve, 100))

    // #then - notification should NOT be sent (activity cancelled it)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should mark session activity on tool.execute.before event", async () => {
    // #given - main session is set
    const mainSessionID = "main-tool"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 50,
      skipIfIncompleteTodos: false,
    })

    // #when - session goes idle, then tool.execute.before fires
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    await hook({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: mainSessionID },
      },
    })

    // Wait for idle delay to pass
    await new Promise((resolve) => setTimeout(resolve, 100))

    // #then - notification should NOT be sent (activity cancelled it)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should not send duplicate notification for same session", async () => {
    // #given - main session is set
    const mainSessionID = "main-dup"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 10,
      skipIfIncompleteTodos: false,
    })

    // #when - session goes idle twice
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    // Wait for first notification
    await new Promise((resolve) => setTimeout(resolve, 50))

    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    // Wait for second potential notification
    await new Promise((resolve) => setTimeout(resolve, 50))

    // #then - only one notification should be sent
    expect(notificationCalls).toHaveLength(1)
  })
})
