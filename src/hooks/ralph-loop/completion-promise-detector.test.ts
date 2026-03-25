/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { detectCompletionInSessionMessages, detectSemanticCompletion } from "./completion-promise-detector"

type SessionMessage = {
  info?: { role?: string }
  parts?: Array<{ type: string; text?: string }>
}

function createPluginInput(messages: SessionMessage[]): PluginInput {
  const pluginInput = {
    client: { session: {} } as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/tmp",
    worktree: "/tmp",
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  } as PluginInput

  pluginInput.client.session.messages =
    (async () => ({ data: messages })) as unknown as PluginInput["client"]["session"]["messages"]

  return pluginInput
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

  describe("#given promise appears in tool_result part (not text part)", () => {
    test("#when Oracle returns VERIFIED via task() tool_result #then should detect completion", async () => {
      const messages: SessionMessage[] = [
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

      expect(detected).toBe(true)
    })

    test("#when DONE appears only in tool_result part #then should detect completion", async () => {
      const messages: SessionMessage[] = [
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

      expect(detected).toBe(true)
    })

    test("#when promise appears in tool_use part (not tool_result) #then should NOT detect completion", async () => {
      const messages: SessionMessage[] = [
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

  describe("#given semantic completion patterns", () => {
    test("#when agent says 'task is complete' #then should detect semantic completion", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "The task is complete. All work has been finished." }],
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

    test("#when agent says 'all items are done' #then should detect semantic completion", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "All items are done and marked as complete." }],
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

    test("#when agent says 'nothing left to do' #then should detect semantic completion", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "There is nothing left to do. Everything is finished." }],
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

    test("#when agent says 'successfully completed all' #then should detect semantic completion", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "I have successfully completed all the required tasks." }],
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

    test("#when promise is VERIFIED #then semantic completion should NOT trigger", async () => {
      // #given
      const messages: SessionMessage[] = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "The task is complete. All work has been finished." }],
        },
      ]
      const ctx = createPluginInput(messages)

      // #when
      const detected = await detectCompletionInSessionMessages(ctx, {
        sessionID: "session-123",
        promise: "VERIFIED",
        apiTimeoutMs: 1000,
        directory: "/tmp",
      })

      // #then
      expect(detected).toBe(false)
    })
  })
})

describe("detectSemanticCompletion", () => {
  describe("#given semantic completion patterns", () => {
    test("#when text contains 'task is complete' #then should return true", () => {
      expect(detectSemanticCompletion("The task is complete.")).toBe(true)
    })

    test("#when text contains 'all items are done' #then should return true", () => {
      expect(detectSemanticCompletion("All items are done.")).toBe(true)
    })

    test("#when text contains 'nothing left to do' #then should return true", () => {
      expect(detectSemanticCompletion("There is nothing left to do.")).toBe(true)
    })

    test("#when text contains 'successfully completed all' #then should return true", () => {
      expect(detectSemanticCompletion("Successfully completed all tasks.")).toBe(true)
    })

    test("#when text contains 'everything is finished' #then should return true", () => {
      expect(detectSemanticCompletion("Everything is finished.")).toBe(true)
    })

    test("#when text does NOT contain completion patterns #then should return false", () => {
      expect(detectSemanticCompletion("Working on the next task.")).toBe(false)
    })

    test("#when text is empty #then should return false", () => {
      expect(detectSemanticCompletion("")).toBe(false)
    })
  })
})
