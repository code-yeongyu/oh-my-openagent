import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test"
import { createSessionNotification } from "./session-notification"
import { setMainSession, subagentSessions, _resetForTesting } from "../features/claude-code-session-state"
import * as utils from "./session-notification-utils"
import * as sender from "./session-notification-sender"

const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const originalDateNow = Date.now

describe("session-notification", () => {
  let notificationCalls: string[]

  function createMockPluginInput() {
    return {
      $: async (cmd: TemplateStringsArray | string, ...values: any[]) => {
        // given - track notification commands (osascript, notify-send, powershell)
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
    jest.useRealTimers()
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    Date.now = originalDateNow
    _resetForTesting()
    notificationCalls = []
    
    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")
    spyOn(utils, "getNotifySendPath").mockResolvedValue("/usr/bin/notify-send")
    spyOn(utils, "getPowershellPath").mockResolvedValue("powershell")
    spyOn(utils, "getAfplayPath").mockResolvedValue("/usr/bin/afplay")
    spyOn(utils, "getPaplayPath").mockResolvedValue("/usr/bin/paplay")
    spyOn(utils, "getAplayPath").mockResolvedValue("/usr/bin/aplay")
    spyOn(utils, "startBackgroundCheck").mockImplementation(() => {})
    spyOn(sender, "detectPlatform").mockReturnValue("darwin")
    spyOn(sender, "sendSessionNotification").mockImplementation(
      async (
        _ctx: Parameters<typeof sender.sendSessionNotification>[0],
        _platform: Parameters<typeof sender.sendSessionNotification>[1],
        _title: Parameters<typeof sender.sendSessionNotification>[2],
        message: Parameters<typeof sender.sendSessionNotification>[3]
      ) => {
        notificationCalls.push(message)
      }
    )
  })

  afterEach(() => {
    // given - cleanup after each test
    jest.useRealTimers()
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    Date.now = originalDateNow
    subagentSessions.clear()
    _resetForTesting()
  })

  test("should not trigger notification for subagent session", async () => {
    // given - a subagent session exists
    const subagentSessionID = "subagent-123"
    subagentSessions.add(subagentSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // when - subagent session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // then - notification should NOT be sent
    expect(notificationCalls).toHaveLength(0)
  })

  test("should not trigger notification when mainSessionID is set and session is not main", async () => {
    // given - main session is set, but a different session goes idle
    const mainSessionID = "main-123"
    const otherSessionID = "other-456"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // when - non-main session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: otherSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // then - notification should NOT be sent
    expect(notificationCalls).toHaveLength(0)
  })

  test("should trigger notification for main session when idle", async () => {
    // given - main session is set
    const mainSessionID = "main-789"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 10,
      skipIfIncompleteTodos: false,
      enforceMainSessionFilter: false,
    })

    // when - main session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    // Wait for idle confirmation delay + buffer
    await new Promise((resolve) => setTimeout(resolve, 100))

    // then - notification should be sent
    expect(notificationCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("should skip notification for subagent even when mainSessionID is set", async () => {
    // given - both mainSessionID and subagent session exist
    const mainSessionID = "main-999"
    const subagentSessionID = "subagent-888"
    setMainSession(mainSessionID)
    subagentSessions.add(subagentSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // when - subagent session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // then - notification should NOT be sent (subagent check takes priority)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should handle subagentSessions and mainSessionID checks in correct order", async () => {
    // given - main session and subagent session exist
    const mainSessionID = "main-111"
    const subagentSessionID = "subagent-222"
    const unknownSessionID = "unknown-333"
    setMainSession(mainSessionID)
    subagentSessions.add(subagentSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 0,
    })

    // when - subagent session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    // when - unknown session goes idle (not main, not in subagentSessions)
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: unknownSessionID },
      },
    })

    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 50))

    // then - no notifications (subagent blocked by subagentSessions, unknown blocked by mainSessionID check)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should cancel pending notification on session activity", async () => {
    // given - main session is set
    const mainSessionID = "main-cancel"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 100,
      skipIfIncompleteTodos: false,
      activityGracePeriodMs: 0,
    })

    // when - session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    // when - activity happens before delay completes
    await hook({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: mainSessionID },
      },
    })

    // Wait for original delay to pass
    await new Promise((resolve) => setTimeout(resolve, 150))

    // then - notification should NOT be sent (cancelled by activity)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should handle session.created event without notification", async () => {
    // given - a new session is created
    const hook = createSessionNotification(createMockPluginInput(), {})

    // when - session.created event fires
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

    // then - no notification should be triggered
    expect(notificationCalls).toHaveLength(0)
  })

  test("should handle session.deleted event and cleanup state", async () => {
    // given - a session exists
    const hook = createSessionNotification(createMockPluginInput(), {})

    // when - session.deleted event fires
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

    // then - no notification should be triggered
    expect(notificationCalls).toHaveLength(0)
  })

  test("should mark session activity on message.updated event", async () => {
    // given - main session is set
    const mainSessionID = "main-message"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 50,
      skipIfIncompleteTodos: false,
      activityGracePeriodMs: 0,
    })

    // when - session goes idle, then message.updated fires
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

    // then - notification should NOT be sent (activity cancelled it)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should mark session activity on tool.execute.before event", async () => {
    // given - main session is set
    const mainSessionID = "main-tool"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 50,
      skipIfIncompleteTodos: false,
      activityGracePeriodMs: 0,
    })

    // when - session goes idle, then tool.execute.before fires
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

    // then - notification should NOT be sent (activity cancelled it)
    expect(notificationCalls).toHaveLength(0)
  })

  test("should not send duplicate notification for same session", async () => {
    // given - main session is set
    const mainSessionID = "main-dup"
    setMainSession(mainSessionID)

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 10,
      skipIfIncompleteTodos: false,
      enforceMainSessionFilter: false,
    })

    // when - session goes idle twice
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

    // then - only one notification should be sent
    expect(notificationCalls).toHaveLength(1)
  })

  function createSenderMockCtx() {
    const notifyCalls: string[] = []
    const mockCtx = {
      $: async (cmd: TemplateStringsArray | string, ...values: any[]) => {
        const cmdStr = typeof cmd === "string"
          ? cmd
          : cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
        notifyCalls.push(cmdStr)
        return { stdout: "", stderr: "", exitCode: 0 }
      },
    } as any
    return { mockCtx, notifyCalls }
  }

  test("should use terminal-notifier with -activate when available on darwin", async () => {
    // given - terminal-notifier is available and __CFBundleIdentifier is set
    spyOn(sender, "sendSessionNotification").mockRestore()
    const { mockCtx, notifyCalls } = createSenderMockCtx()
    spyOn(utils, "getTerminalNotifierPath").mockResolvedValue("/usr/local/bin/terminal-notifier")
    const originalEnv = process.env.__CFBundleIdentifier
    process.env.__CFBundleIdentifier = "com.mitchellh.ghostty"

    try {
      // when - sendSessionNotification is called directly on darwin
      await sender.sendSessionNotification(mockCtx, "darwin", "Test Title", "Test Message")

      // then - notification uses terminal-notifier with -activate flag
      expect(notifyCalls.length).toBeGreaterThanOrEqual(1)
      const tnCall = notifyCalls.find(c => c.includes("terminal-notifier"))
      expect(tnCall).toBeDefined()
      expect(tnCall).toContain("-activate")
      expect(tnCall).toContain("com.mitchellh.ghostty")
    } finally {
      if (originalEnv !== undefined) {
        process.env.__CFBundleIdentifier = originalEnv
      } else {
        delete process.env.__CFBundleIdentifier
      }
    }
  })

  test("should fall back to osascript when terminal-notifier is not available", async () => {
    // given - terminal-notifier is NOT available
    spyOn(sender, "sendSessionNotification").mockRestore()
    const { mockCtx, notifyCalls } = createSenderMockCtx()
    spyOn(utils, "getTerminalNotifierPath").mockResolvedValue(null)
    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")

    // when - sendSessionNotification is called directly on darwin
    await sender.sendSessionNotification(mockCtx, "darwin", "Test Title", "Test Message")

    // then - notification uses osascript (fallback)
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1)
    const osascriptCall = notifyCalls.find(c => c.includes("osascript"))
    expect(osascriptCall).toBeDefined()
    const tnCall = notifyCalls.find(c => c.includes("terminal-notifier"))
    expect(tnCall).toBeUndefined()
  })

  test("should fall back to osascript when terminal-notifier execution fails", async () => {
    // given - terminal-notifier exists but invocation fails
    spyOn(sender, "sendSessionNotification").mockRestore()
    const notifyCalls: string[] = []
    const mockCtx = {
      $: async (cmd: TemplateStringsArray | string, ...values: unknown[]) => {
        const cmdStr = typeof cmd === "string"
          ? cmd
          : cmd.reduce((acc, part, index) => `${acc}${part}${String(values[index] ?? "")}`, "")
        notifyCalls.push(cmdStr)

        if (cmdStr.includes("terminal-notifier")) {
          throw new Error("terminal-notifier failed")
        }

        return { stdout: "", stderr: "", exitCode: 0 }
      },
    } as any
    spyOn(utils, "getTerminalNotifierPath").mockResolvedValue("/usr/local/bin/terminal-notifier")
    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")

    // when - sendSessionNotification is called directly on darwin
    await sender.sendSessionNotification(mockCtx, "darwin", "Test Title", "Test Message")

    // then - osascript fallback should be attempted after terminal-notifier failure
    const tnCall = notifyCalls.find(c => c.includes("terminal-notifier"))
    const osascriptCall = notifyCalls.find(c => c.includes("osascript"))
    expect(tnCall).toBeDefined()
    expect(osascriptCall).toBeDefined()
  })

  test("should invoke terminal-notifier without array interpolation", async () => {
    // given - shell interpolation rejects array values
    spyOn(sender, "sendSessionNotification").mockRestore()
    const notifyCalls: string[] = []
    const mockCtx = {
      $: async (cmd: TemplateStringsArray | string, ...values: unknown[]) => {
        if (values.some(Array.isArray)) {
          throw new Error("array interpolation unsupported")
        }

        const commandString = typeof cmd === "string"
          ? cmd
          : cmd.reduce((acc, part, index) => `${acc}${part}${String(values[index] ?? "")}`, "")
        notifyCalls.push(commandString)
        return { stdout: "", stderr: "", exitCode: 0 }
      },
    } as any
    spyOn(utils, "getTerminalNotifierPath").mockResolvedValue("/usr/local/bin/terminal-notifier")
    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")

    // when - terminal-notifier command is executed
    await sender.sendSessionNotification(mockCtx, "darwin", "Test Title", "Test Message")

    // then - terminal-notifier succeeds directly and fallback is not used
    const tnCall = notifyCalls.find(c => c.includes("terminal-notifier"))
    const osascriptCall = notifyCalls.find(c => c.includes("osascript"))
    expect(tnCall).toBeDefined()
    expect(osascriptCall).toBeUndefined()
  })

  test("should use terminal-notifier without -activate when __CFBundleIdentifier is not set", async () => {
    // given - terminal-notifier available but no bundle ID
    spyOn(sender, "sendSessionNotification").mockRestore()
    const { mockCtx, notifyCalls } = createSenderMockCtx()
    spyOn(utils, "getTerminalNotifierPath").mockResolvedValue("/usr/local/bin/terminal-notifier")
    const originalEnv = process.env.__CFBundleIdentifier
    delete process.env.__CFBundleIdentifier

    try {
      // when - sendSessionNotification is called directly on darwin
      await sender.sendSessionNotification(mockCtx, "darwin", "Test Title", "Test Message")

      // then - terminal-notifier used but without -activate flag
      expect(notifyCalls.length).toBeGreaterThanOrEqual(1)
      const tnCall = notifyCalls.find(c => c.includes("terminal-notifier"))
      expect(tnCall).toBeDefined()
      expect(tnCall).not.toContain("-activate")
    } finally {
      if (originalEnv !== undefined) {
        process.env.__CFBundleIdentifier = originalEnv
      }
    }
  })

  test("should ignore activity events within grace period", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))

    try {
      // given - a regular session notification is scheduled
      const sessionID = "main-grace"

      const hook = createSessionNotification(createMockPluginInput(), {
        idleConfirmationDelay: 50,
        skipIfIncompleteTodos: false,
        activityGracePeriodMs: 100,
        enforceMainSessionFilter: false,
      })

      // when - session goes idle
      await hook({
        event: {
          type: "session.idle",
          properties: { sessionID },
        },
      })

      // when - activity happens immediately (within grace period)
      await hook({
        event: {
          type: "tool.execute.before",
          properties: { sessionID },
        },
      })

      // when - idle confirmation delay passes deterministically
      jest.advanceTimersByTime(50)
      jest.runOnlyPendingTimers()
      await Promise.resolve()

      // then - notification SHOULD be sent (activity was within grace period, ignored)
      expect(notificationCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      jest.clearAllTimers()
      jest.useRealTimers()
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      Date.now = originalDateNow
    }
  })

  test("should cancel notification for activity after grace period", async () => {
    // given - a regular session notification is scheduled
    const sessionID = "main-grace-cancel"

    const hook = createSessionNotification(createMockPluginInput(), {
      idleConfirmationDelay: 200,
      skipIfIncompleteTodos: false,
      activityGracePeriodMs: 50,
      enforceMainSessionFilter: false,
    })

    // when - session goes idle
    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // when - wait for grace period to pass
    await new Promise((resolve) => setTimeout(resolve, 60))

    // when - activity happens after grace period
    await hook({
      event: {
        type: "tool.execute.before",
        properties: { sessionID },
      },
    })

    // Wait for original delay to pass
    await new Promise((resolve) => setTimeout(resolve, 200))

    // then - notification should NOT be sent (activity cancelled it after grace period)
    expect(notificationCalls).toHaveLength(0)
  })
})
