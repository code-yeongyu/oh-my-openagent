const { describe, expect, test } = require("bun:test")
import { buildReadyNotificationContent } from "./session-notification-content"

describe("buildReadyNotificationContent", () => {
  describe("#given session metadata and messages exist", () => {
    test("#when ready notification content is built, #then it includes session title, last user query, and last assistant line", async () => {
      const ctx = {
        directory: "/tmp/test",
        client: {
          session: {
            get: async () => ({ data: { title: "Bugfix session" } }),
            messages: async () => ({
              data: [
                {
                  info: { role: "user" },
                  parts: [{ type: "text", text: "Investigate\nthis flaky test" }],
                },
                {
                  info: { role: "assistant" },
                  parts: [{ type: "text", text: "First line\nFinal answer line" }],
                },
              ],
            }),
          },
        },
      }

      const result = await buildReadyNotificationContent(ctx, {
        sessionID: "ses_123",
        baseTitle: "OpenCode",
        baseMessage: "Agent is ready for input",
      })

      expect(result).toEqual({
        title: "OpenCode · Bugfix session",
        message: "Agent is ready for input\nUser: Investigate this flaky test\nAssistant: Final answer line",
      })
    })

    test("#when last assistant has gateway usage #then it appends cost tok/s and winning model", async () => {
      const ctx = {
        directory: "/tmp/test",
        client: {
          session: {
            get: async () => ({ data: { title: "Bugfix session" } }),
            messages: async () => ({
              data: [
                {
                  info: { role: "user" },
                  parts: [{ type: "text", text: "hi" }],
                },
                {
                  info: {
                    role: "assistant",
                    cost: 9.99,
                    modelID: "requested-combo",
                    usage: { cost: 0.0123, tokens_per_second: 80.5, model: "winner-model" },
                  },
                  parts: [{ type: "text", text: "done" }],
                },
              ],
            }),
          },
        },
      }

      const result = await buildReadyNotificationContent(ctx, {
        sessionID: "ses_123",
        baseTitle: "OpenCode",
        baseMessage: "Agent is ready for input",
      })

      expect(result.message).toContain("cost $0.0123 · tok/s 80.5 · model winner-model")
    })
  })

  describe("#given session APIs do not provide rich data", () => {
    test("#when ready notification content is built, #then it falls back to session id and the base message", async () => {
      const ctx = {
        directory: "/tmp/test",
        client: {
          session: {
            get: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
          },
        },
      }

      const result = await buildReadyNotificationContent(ctx, {
        sessionID: "ses_fallback",
        baseTitle: "OpenCode",
        baseMessage: "Agent is ready for input",
      })

      expect(result).toEqual({
        title: "OpenCode · ses_fallback",
        message: "Agent is ready for input",
      })
    })
  })
})

export {}
