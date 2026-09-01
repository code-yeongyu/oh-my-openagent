const { describe, expect, test, beforeEach, afterEach, spyOn } = require("bun:test")

const { createSessionNotification } = require("./session-notification")
const { setMainSession, subagentSessions, _resetForTesting } = require("../features/claude-code-session-state")
const utils = require("./session-notification-utils")
const sender = require("./session-notification-sender")

describe("session-notification input-needed events", () => {
  let notificationCalls: string[]
  let scriptCalls: Array<Record<string, unknown> | undefined>

  function createMockPluginInput() {
    return {
      $: async (cmd: TemplateStringsArray | string, ...values: unknown[]) => {
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
    }
  }

  beforeEach(() => {
    _resetForTesting()
    notificationCalls = []
    scriptCalls = []

    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")
    spyOn(utils, "getNotifySendPath").mockResolvedValue("/usr/bin/notify-send")
    spyOn(utils, "getPowershellPath").mockResolvedValue("powershell")
    spyOn(utils, "startBackgroundCheck").mockImplementation(() => {})
    spyOn(sender, "detectPlatform").mockReturnValue("darwin")
    spyOn(sender, "sendSessionNotification").mockImplementation(async (_ctx: unknown, _platform: unknown, _title: unknown, message: string, script: Record<string, unknown> | undefined) => {
      notificationCalls.push(message)
      scriptCalls.push(script)
    })
  })

  afterEach(() => {
    subagentSessions.clear()
    _resetForTesting()
  })

  test("sends question notification when question tool asks for input", async () => {
    const sessionID = "main-question"
    setMainSession(sessionID)
    const hook = createSessionNotification(createMockPluginInput(), { enforceMainSessionFilter: false })

    await hook({
      event: {
        type: "tool.execute.before",
        properties: {
          sessionID,
          tool: "question",
          args: {
            questions: [
              {
                question: "Which branch should we use?",
                options: [{ label: "main" }, { label: "dev" }],
              },
            ],
          },
        },
      },
    })

    expect(notificationCalls).toHaveLength(1)
    expect(notificationCalls[0]).toContain("Agent is asking a question")
  })

  test("sends permission notification for permission events", async () => {
    const sessionID = "main-permission"
    setMainSession(sessionID)
    const hook = createSessionNotification(createMockPluginInput(), { enforceMainSessionFilter: false })

    await hook({
      event: {
        type: "permission.asked",
        properties: {
          sessionID,
        },
      },
    })

    expect(notificationCalls).toHaveLength(1)
    expect(notificationCalls[0]).toContain("Agent needs permission to continue")
  })

  test("passes custom script context for idle, permission, and question notifications", async () => {
    const sessionID = "main-custom-script"
    setMainSession(sessionID)
    const hook = createSessionNotification(createMockPluginInput(), {
      script: "~/.config/opencode/notification.sh",
      enforceMainSessionFilter: false,
      idleConfirmationDelay: 0,
      skipIfIncompleteTodos: false,
    })

    await hook({ event: { type: "session.idle", properties: { sessionID } } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await hook({ event: { type: "permission.asked", properties: { sessionID } } })
    await hook({
      event: {
        type: "tool.execute.before",
        properties: {
          sessionID,
          tool: "question",
          args: { questions: [{ question: "Which branch?" }] },
        },
      },
    })

    expect(scriptCalls.map((call) => call?.hookType)).toEqual(["idle", "permission", "question"])
    expect(scriptCalls.every((call) => call?.scriptPath === "~/.config/opencode/notification.sh")).toBe(true)
  })

  test("runs a custom script when desktop notifications are unsupported", async () => {
    const sessionID = "unsupported-custom-script"
    spyOn(sender, "detectPlatform").mockReturnValue("unsupported")
    const hook = createSessionNotification(createMockPluginInput(), {
      script: "/tmp/notification.sh",
      enforceMainSessionFilter: false,
    })

    await hook({ event: { type: "permission.asked", properties: { sessionID } } })

    expect(scriptCalls[0]?.hookType).toBe("permission")
  })

  test("lazily detects platform and starts background checks on first idle event", async () => {
    const sessionID = "main-idle"
    setMainSession(sessionID)

    const detectPlatformSpy = spyOn(sender, "detectPlatform")
    detectPlatformSpy.mockReturnValue("darwin")

    const getDefaultSoundPathSpy = spyOn(sender, "getDefaultSoundPath")
    getDefaultSoundPathSpy.mockReturnValue("/System/Library/Sounds/Glass.aiff")

    const startBackgroundCheckSpy = spyOn(utils, "startBackgroundCheck")
    startBackgroundCheckSpy.mockImplementation(() => {})

    // given
    const hook = createSessionNotification(createMockPluginInput(), { enforceMainSessionFilter: false })

    // when
    await hook({
      event: {
        type: "session.idle",
        properties: {
          sessionID,
        },
      },
    })

    // then
    expect(detectPlatformSpy).toHaveBeenCalledTimes(1)
    expect(getDefaultSoundPathSpy).toHaveBeenCalledTimes(1)
    expect(startBackgroundCheckSpy).toHaveBeenCalledTimes(1)

    // when
    await hook({
      event: {
        type: "session.idle",
        properties: {
          sessionID,
        },
      },
    })

    // then
    expect(detectPlatformSpy).toHaveBeenCalledTimes(1)
    expect(getDefaultSoundPathSpy).toHaveBeenCalledTimes(1)
    expect(startBackgroundCheckSpy).toHaveBeenCalledTimes(1)

    // when
    await hook({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: sessionID },
        },
      },
    })
  })
})

export {}
