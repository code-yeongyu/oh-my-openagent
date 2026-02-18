import { describe, expect, it, spyOn } from "bun:test"
import type { EventPayload, RunContext } from "./types"
import { createEventState } from "./events"
import { processEvents } from "./event-stream-processor"

function stripAnsi(str: string): string {
  return str.replace(new RegExp("\x1b\\[[0-9;]*m", "g"), "")
}

const createMockContext = (sessionID: string = "test-session"): RunContext => ({
  client: {} as RunContext["client"],
  sessionID,
  directory: "/test",
  abortController: new AbortController(),
})

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item
  }
}

describe("message.part.delta handling", () => {
  it("prints streaming text incrementally from delta events", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          field: "text",
          delta: "Hello",
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          field: "text",
          delta: " world",
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    expect(state.hasReceivedMeaningfulWork).toBe(true)
    expect(state.lastPartText).toBe("Hello world")
    expect(stdoutSpy).toHaveBeenCalledTimes(2)
    stdoutSpy.mockRestore()
  })

  it("does not suppress assistant tool/text parts when state role is stale user", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    state.currentMessageRole = "user"
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const payload: EventPayload = {
      type: "message.part.updated",
      properties: {
        part: {
          sessionID: "ses_main",
          type: "tool",
          tool: "task_create",
          state: { status: "running" },
        },
      },
    }

    //#when
    const { handleMessagePartUpdated } = require("./event-handlers") as {
      handleMessagePartUpdated: (ctx: RunContext, payload: EventPayload, state: ReturnType<typeof createEventState>) => void
    }
    handleMessagePartUpdated(ctx, payload, state)

    //#then
    expect(state.currentTool).toBe("task_create")
    expect(state.hasReceivedMeaningfulWork).toBe(true)
    stdoutSpy.mockRestore()
  })

  it("renders agent header using profile hex color when available", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    state.agentColorsByName["Sisyphus (Ultraworker)"] = "#00CED1"
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const payload: EventPayload = {
      type: "message.updated",
      properties: {
        info: {
          sessionID: "ses_main",
          role: "assistant",
          agent: "Sisyphus (Ultraworker)",
          modelID: "claude-opus-4-6",
          variant: "max",
        },
      },
    }

    //#when
    const { handleMessageUpdated } = require("./event-handlers") as {
      handleMessageUpdated: (ctx: RunContext, payload: EventPayload, state: ReturnType<typeof createEventState>) => void
    }
    handleMessageUpdated(ctx, payload, state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    expect(rendered).toContain("\u001b[38;2;0;206;209m")
    expect(rendered).toContain("claude-opus-4-6 (max)")
    expect(rendered).toContain("└─")
    expect(rendered).toContain("Sisyphus (Ultraworker)")
    stdoutSpy.mockRestore()
  })

  it("separates think block output from normal response output", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.updated",
        properties: {
          info: { sessionID: "ses_main", role: "assistant", agent: "Sisyphus (Ultraworker)", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "think-1", sessionID: "ses_main", type: "reasoning", text: "" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          partID: "think-1",
          field: "text",
          delta: "Composing final summary in Korean with clear concise structure",
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "text-1", sessionID: "ses_main", type: "text", text: "" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          partID: "text-1",
          field: "text",
          delta: "answer",
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    const plain = stripAnsi(rendered)
    expect(plain).toContain("Thinking:")
    expect(plain).toContain("Composing final summary in Korean")
    expect(plain).toContain("answer")
    stdoutSpy.mockRestore()
  })

  it("updates thinking line incrementally on delta updates", async () => {
    //#given
    const previous = process.env.GITHUB_ACTIONS
    delete process.env.GITHUB_ACTIONS

    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.updated",
        properties: {
          info: { sessionID: "ses_main", role: "assistant", agent: "Sisyphus (Ultraworker)", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "think-1", sessionID: "ses_main", type: "reasoning", text: "" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          partID: "think-1",
          field: "text",
          delta: "Composing final summary",
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          partID: "think-1",
          field: "text",
          delta: " in Korean with specifics.",
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    const plain = stripAnsi(rendered)
    expect(plain).toContain("Thinking:")
    expect(plain).toContain("Composing final summary")
    expect(plain).toContain("in Korean with specifics.")

    if (previous !== undefined) process.env.GITHUB_ACTIONS = previous
    stdoutSpy.mockRestore()
  })

  it("does not re-render identical thinking summary repeatedly", async () => {
    //#given
    const previous = process.env.GITHUB_ACTIONS
    delete process.env.GITHUB_ACTIONS

    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.updated",
        properties: {
          info: { id: "msg_assistant", sessionID: "ses_main", role: "assistant", agent: "Sisyphus (Ultraworker)", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "think-1", messageID: "msg_assistant", sessionID: "ses_main", type: "reasoning", text: "" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_assistant",
          partID: "think-1",
          field: "text",
          delta: "The user wants me",
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_assistant",
          partID: "think-1",
          field: "text",
          delta: " to",
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_assistant",
          partID: "think-1",
          field: "text",
          delta: " ",
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    const plain = stripAnsi(rendered)
    const renderCount = plain.split("Thinking:").length - 1
    expect(renderCount).toBe(1)

    if (previous !== undefined) process.env.GITHUB_ACTIONS = previous
    stdoutSpy.mockRestore()
  })

  it("does not truncate thinking content", async () => {
    //#given
    const previous = process.env.GITHUB_ACTIONS
    delete process.env.GITHUB_ACTIONS

    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const longThinking = "This is a very long thinking stream that should never be truncated and must include final tail marker END-OF-THINKING-MARKER"
    const events: EventPayload[] = [
      {
        type: "message.updated",
        properties: {
          info: { id: "msg_assistant", sessionID: "ses_main", role: "assistant", agent: "Sisyphus (Ultraworker)", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "think-1", messageID: "msg_assistant", sessionID: "ses_main", type: "reasoning", text: "" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_assistant",
          partID: "think-1",
          field: "text",
          delta: longThinking,
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    expect(rendered).toContain("END-OF-THINKING-MARKER")

    if (previous !== undefined) process.env.GITHUB_ACTIONS = previous
    stdoutSpy.mockRestore()
  })

  it("applies left and right padding to assistant text output", async () => {
    //#given
    const previous = process.env.GITHUB_ACTIONS
    delete process.env.GITHUB_ACTIONS

    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.updated",
        properties: {
          info: { id: "msg_assistant", sessionID: "ses_main", role: "assistant", agent: "Sisyphus (Ultraworker)", modelID: "claude-opus-4-6", variant: "max" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_assistant",
          partID: "part_assistant_text",
          field: "text",
          delta: "hello\nworld",
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    expect(rendered).toContain("  hello  \n  world")

    if (previous !== undefined) process.env.GITHUB_ACTIONS = previous
    stdoutSpy.mockRestore()
  })

  it("does not render user message parts in output stream", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.updated",
        properties: {
          info: { id: "msg_user", sessionID: "ses_main", role: "user", agent: "Sisyphus (Ultraworker)", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "part_user_text", messageID: "msg_user", sessionID: "ses_main", type: "text", text: "[search-mode] should not print" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_user",
          partID: "part_user_text",
          field: "text",
          delta: "still should not print",
        },
      },
      {
        type: "message.updated",
        properties: {
          info: { id: "msg_assistant", sessionID: "ses_main", role: "assistant", agent: "Sisyphus (Ultraworker)", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_assistant",
          partID: "part_assistant_text",
          field: "text",
          delta: "assistant output",
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    expect(rendered.includes("[search-mode] should not print")).toBe(false)
    expect(rendered.includes("still should not print")).toBe(false)
    expect(rendered).toContain("assistant output")
    stdoutSpy.mockRestore()
  })

  it("renders tool header and full tool output without truncation", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const longTail = "END-OF-TOOL-OUTPUT-MARKER"
    const events: EventPayload[] = [
      {
        type: "tool.execute",
        properties: {
          sessionID: "ses_main",
          name: "read",
          input: { filePath: "src/index.ts", offset: 1, limit: 200 },
        },
      },
      {
        type: "tool.result",
        properties: {
          sessionID: "ses_main",
          name: "read",
          output: `line1\nline2\n${longTail}`,
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    expect(rendered).toContain("→")
    expect(rendered).toContain("Read src/index.ts")
    expect(rendered).toContain("END-OF-TOOL-OUTPUT-MARKER")
    stdoutSpy.mockRestore()
  })

  it("renders tool header only once when message.part.updated fires multiple times for same running tool", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-1",
            sessionID: "ses_main",
            type: "tool",
            tool: "bash",
            state: { status: "running", input: { command: "bun test" } },
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-1",
            sessionID: "ses_main",
            type: "tool",
            tool: "bash",
            state: { status: "running", input: { command: "bun test" } },
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-1",
            sessionID: "ses_main",
            type: "tool",
            tool: "bash",
            state: { status: "running", input: { command: "bun test" } },
          },
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    const headerCount = rendered.split("bun test").length - 1
    expect(headerCount).toBe(1)
    stdoutSpy.mockRestore()
  })

  it("renders tool header only once when both tool.execute and message.part.updated fire", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "tool.execute",
        properties: {
          sessionID: "ses_main",
          name: "bash",
          input: { command: "bun test" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-1",
            sessionID: "ses_main",
            type: "tool",
            tool: "bash",
            state: { status: "running", input: { command: "bun test" } },
          },
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    const headerCount = rendered.split("bun test").length - 1
    expect(headerCount).toBe(1)
    stdoutSpy.mockRestore()
  })

  it("renders tool output only once when both tool.result and message.part.updated(completed) fire", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "tool.execute",
        properties: {
          sessionID: "ses_main",
          name: "bash",
          input: { command: "bun test" },
        },
      },
      {
        type: "tool.result",
        properties: {
          sessionID: "ses_main",
          name: "bash",
          output: "UNIQUE-OUTPUT-MARKER",
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-1",
            sessionID: "ses_main",
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "bun test" }, output: "UNIQUE-OUTPUT-MARKER" },
          },
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    const outputCount = rendered.split("UNIQUE-OUTPUT-MARKER").length - 1
    expect(outputCount).toBe(1)
    stdoutSpy.mockRestore()
  })

  it("does not re-render text when message.updated fires multiple times for same message", async () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const events: EventPayload[] = [
      {
        type: "message.updated",
        properties: {
          info: { id: "msg_1", sessionID: "ses_main", role: "assistant", agent: "Sisyphus", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_main",
          messageID: "msg_1",
          field: "text",
          delta: "Hello world",
        },
      },
      {
        type: "message.updated",
        properties: {
          info: { id: "msg_1", sessionID: "ses_main", role: "assistant", agent: "Sisyphus", modelID: "claude-opus-4-6" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "text-1", sessionID: "ses_main", type: "text", text: "Hello world" },
        },
      },
    ]

    //#when
    await processEvents(ctx, toAsyncIterable(events), state)

    //#then
    const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? "")).join("")
    const textCount = rendered.split("Hello world").length - 1
    expect(textCount).toBe(1)
    stdoutSpy.mockRestore()
  })
})
