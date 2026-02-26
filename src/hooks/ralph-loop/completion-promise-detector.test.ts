/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { detectCompletionInSessionMessages } from "./completion-promise-detector"

type SessionMessage = {
  info?: { role?: string }
  parts?: Array<{ type: string; text?: string }>
}

function createPluginInput(messages: SessionMessage[]): PluginInput {
  return {
    client: {
      session: {
        messages: async () => ({ data: messages }),
      },
    },
  } as PluginInput
}

describe("detectCompletionInSessionMessages", () => {
  describe("#given session with prior DONE and new messages", () => {
    test("#when sinceMessageIndex excludes prior DONE #then should NOT detect completion", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Old completion <promise>DONE</promise>" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Working on the new task" }],
        },
      ]
      const ctx = createPluginInput(messages)

      // #when
      const detected = await detectCompletionInSessionMessages(ctx, {
        sessionID: "session-123",
        promise: "DONE",
        apiTimeoutMs: 1000,
        directory: "/tmp",
        sinceMessageIndex: 1,
      })

      // #then
      expect(detected).toBe(false)
    })

    test("#when sinceMessageIndex includes current DONE #then should detect completion", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Old completion <promise>DONE</promise>" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Current completion <promise>DONE</promise>" }],
        },
      ]
      const ctx = createPluginInput(messages)

      // #when
      const detected = await detectCompletionInSessionMessages(ctx, {
        sessionID: "session-123",
        promise: "DONE",
        apiTimeoutMs: 1000,
        directory: "/tmp",
        sinceMessageIndex: 1,
      })

      // #then
      expect(detected).toBe(true)
    })
  })

  describe("#given no sinceMessageIndex (backward compat)", () => {
    test("#then should scan all messages", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Old completion <promise>DONE</promise>" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "No completion in latest message" }],
        },
      ]
      const ctx = createPluginInput(messages)

      // #when
      const detected = await detectCompletionInSessionMessages(ctx, {
        sessionID: "session-123",
        promise: "DONE",
        apiTimeoutMs: 1000,
        directory: "/tmp",
      })

      // #then
      expect(detected).toBe(true)
    })
  })
})
