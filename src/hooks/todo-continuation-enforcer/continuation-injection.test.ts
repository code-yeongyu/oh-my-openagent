declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import { injectContinuation } from "./continuation-injection"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"

describe("injectContinuation", () => {
  test("inherits tools from resolved message info when reinjecting", async () => {
    // given
    let capturedTools: Record<string, boolean> | undefined
    let capturedText: string | undefined
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async (input: {
            body: {
              tools?: Record<string, boolean>
              parts?: Array<{ type: string; text: string }>
            }
          }) => {
            capturedTools = input.body.tools
            capturedText = input.body.parts?.[0]?.text
            return {}
          },
        },
      },
    }
    const sessionStateStore = {
      getExistingState: () => ({ inFlight: false, lastInjectedAt: 0, consecutiveFailures: 0 }),
    }

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID: "ses_continuation_tools",
      resolvedInfo: {
        agent: "Hephaestus",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        tools: { question: "deny", bash: "allow" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(capturedTools).toEqual({ question: false, bash: true })
    expect(capturedText).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })
})
