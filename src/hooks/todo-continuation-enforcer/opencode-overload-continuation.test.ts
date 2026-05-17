import { describe, expect, test } from "bun:test"

import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"
import { createTodoContinuationEnforcer } from "."

type PromptCall = {
  sessionID: string
  text: string
}

type PromptInput = {
  path: { id: string }
  body: { parts: Array<{ text: string }> }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createPluginInput(promptCalls: PromptCall[]): Parameters<typeof createTodoContinuationEnforcer>[0] {
  return {
    directory: "/tmp/opencode-overload-continuation-test",
    client: {
      session: {
        todo: async () => ({
          data: [
            { id: "1", content: "Keep working", status: "pending", priority: "high" },
          ],
        }),
        messages: async () => ({ data: [] }),
        promptAsync: async (input: PromptInput) => {
          promptCalls.push({
            sessionID: input.path.id,
            text: input.body.parts[0]?.text ?? "",
          })
          return {}
        },
      },
      tui: {
        showToast: async () => ({}),
      },
    },
  } as Parameters<typeof createTodoContinuationEnforcer>[0]
}

describe("todo-continuation-enforcer OpenCode overload errors", () => {
  test(
    "#given countdown is armed #when OpenCode reports server_is_overloaded #then continuation still injects",
    async () => {
      // given
      const sessionID = "main-opencode-overload"
      const promptCalls: PromptCall[] = []
      _resetForTesting()
      setMainSession(sessionID)
      const hook = createTodoContinuationEnforcer(createPluginInput(promptCalls))

      await hook.handler({
        event: { type: "session.idle", properties: { sessionID } },
      })

      // when
      await hook.handler({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              type: "error",
              sequence_number: 2,
              error: {
                type: "service_unavailable_error",
                code: "server_is_overloaded",
                message: "Our servers are currently overloaded. Please try again later.",
                param: null,
              },
            },
          },
        },
      })
      await wait(2500)

      // then
      expect(promptCalls).toHaveLength(1)
      expect(promptCalls[0]?.sessionID).toBe(sessionID)
      expect(promptCalls[0]?.text).toContain("TODO CONTINUATION")
    },
    { timeout: 10000 },
  )
})
