const { describe, expect, test, beforeEach, afterEach, spyOn } = require("bun:test")

const { createSessionNotification } = require("./session-notification")
const { setMainSession, subagentSessions, _resetForTesting } = require("../features/claude-code-session-state")
const utils = require("./session-notification-utils")

describe("session-notification input-needed events", () => {
  let notificationCalls: string[]

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

    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")
    spyOn(utils, "getNotifySendPath").mockResolvedValue("/usr/bin/notify-send")
    spyOn(utils, "getPowershellPath").mockResolvedValue("powershell")
    spyOn(utils, "startBackgroundCheck").mockImplementation(() => {})
  })

  afterEach(() => {
    subagentSessions.clear()
    _resetForTesting()
  })

  test("sends question notification when question tool asks for input", async () => {
    const sessionID = "main-question"
    setMainSession(sessionID)
    const hook = createSessionNotification(createMockPluginInput())

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
    const hook = createSessionNotification(createMockPluginInput())

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
})

export {}
