/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { detectCompletionInSessionMessages } from "./completion-promise-detector"
import { createPluginInput } from "./completion-promise-detector-test-input"

describe("detectCompletionInSessionMessages", () => {
  describe("#given session with prior DONE and new messages", () => {
    test("#when sinceMessageIndex excludes prior DONE #then should NOT detect completion", async () => {
      // #given
      const messages = [
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
      const messages = [
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
      const messages = [
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

  describe("#given promise appears in tool_result part (not text part)", () => {
    test("#when Oracle returns VERIFIED via task() tool_result #then should NOT detect completion", async () => {
      const messages = [
        {
          info: { role: "assistant" },
          parts: [
            { type: "text", text: "Consulting Oracle for verification." },
            { type: "tool_use", text: '{"subagent_type":"oracle"}' },
          ],
        },
        {
          info: { role: "assistant" },
          parts: [
            { type: "tool_result", text: 'Task completed.\n\nAgent: oracle\n\n<promise>VERIFIED</promise>\n\n<task_metadata>\nsession_id: ses_abc123\n</task_metadata>' },
            { type: "text", text: "Oracle verified the task." },
          ],
        },
      ]
      const ctx = createPluginInput(messages)

      const detected = await detectCompletionInSessionMessages(ctx, {
        sessionID: "session-123",
        promise: "VERIFIED",
        apiTimeoutMs: 1000,
        directory: "/tmp",
        sinceMessageIndex: 0,
      })

      expect(detected).toBe(false)
    })

    test("#when DONE appears only in tool_result part #then should NOT detect completion", async () => {
      const messages = [
        {
          info: { role: "assistant" },
          parts: [
            { type: "tool_result", text: 'Background task output <promise>DONE</promise>' },
            { type: "text", text: "Task completed successfully." },
          ],
        },
      ]
      const ctx = createPluginInput(messages)

      const detected = await detectCompletionInSessionMessages(ctx, {
        sessionID: "session-123",
        promise: "DONE",
        apiTimeoutMs: 1000,
        directory: "/tmp",
      })

      expect(detected).toBe(false)
    })

    test("#when promise appears in tool_use part (not tool_result) #then should NOT detect completion", async () => {
      const messages = [
        {
          info: { role: "assistant" },
          parts: [
            { type: "tool_use", text: 'prompt containing <promise>VERIFIED</promise> as instruction' },
            { type: "text", text: "Calling Oracle." },
          ],
        },
      ]
      const ctx = createPluginInput(messages)

      const detected = await detectCompletionInSessionMessages(ctx, {
        sessionID: "session-123",
        promise: "VERIFIED",
        apiTimeoutMs: 1000,
        directory: "/tmp",
      })

      expect(detected).toBe(false)
    })
  })
})
