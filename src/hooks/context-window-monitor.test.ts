import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, mock, test } from "bun:test"
import { createContextWindowMonitorHook } from "./context-window-monitor"

function createMockCtx(overrides?: { messages?: ReturnType<typeof mock> }) {
  const messages = overrides?.messages ?? mock(() => Promise.resolve({ data: [] }))
  return {
    client: { session: { messages } },
    directory: "/tmp/test",
  } as unknown as PluginInput
}

describe("context-window-monitor", () => {
  test("appends context reminder when usage exceeds 70% threshold based on resolved limit", async () => {
    //#given
    const sessionID = "context-window-monitor-threshold-session"
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 150000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const hook = createContextWindowMonitorHook(createMockCtx({ messages }))
    const output = { title: "", output: "tool result", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-1" },
      output
    )

    //#then
    expect(output.output).toContain("[Context Status:")
  })

  test("does not append reminder when usage is below threshold", async () => {
    //#given
    const sessionID = "context-window-monitor-below-threshold-session"
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 100000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const hook = createContextWindowMonitorHook(createMockCtx({ messages }))
    const output = { title: "", output: "tool result", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-2" },
      output
    )

    //#then
    expect(output.output).not.toContain("[Context Status:")
  })

  test("skips non-anthropic providers", async () => {
    //#given
    const sessionID = "context-window-monitor-non-anthropic-session"
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "openai",
              modelID: "gpt-5",
              tokens: {
                input: 190000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const hook = createContextWindowMonitorHook(createMockCtx({ messages }))
    const output = { title: "", output: "tool result", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-3" },
      output
    )

    //#then
    expect(output.output).not.toContain("[Context Status:")
  })

  test("only reminds once per session", async () => {
    //#given
    const sessionID = "context-window-monitor-once-per-session"
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 150000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const hook = createContextWindowMonitorHook(createMockCtx({ messages }))
    const output = { title: "", output: "tool result", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-4-1" },
      output
    )
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-4-2" },
      output
    )

    //#then
    const reminderCount = output.output.split("[Context Status:").length - 1
    expect(reminderCount).toBe(1)
    expect(messages).toHaveBeenCalledTimes(1)
  })

  test("handles vertex-anthropic provider", async () => {
    //#given
    const sessionID = "context-window-monitor-vertex-anthropic-session"
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "vertex-anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 150000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const hook = createContextWindowMonitorHook(createMockCtx({ messages }))
    const output = { title: "", output: "tool result", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-vertex" },
      output
    )

    //#then
    expect(output.output).toContain("[Context Status:")
  })

  test("displays model-appropriate limit in status text", async () => {
    //#given
    const sessionID = "context-window-monitor-display-limit"
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 150000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const hook = createContextWindowMonitorHook(createMockCtx({ messages }))
    const output = { title: "", output: "tool result", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-display" },
      output
    )

    //#then
    expect(output.output).toContain("200k context window")
    expect(output.output).toContain("200,000")
  })

  test("uses resolved model-aware context limit instead of hardcoded fallback", async () => {
    //#given
    const sessionID = "context-window-monitor-model-aware-limit"
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              contextWindowLimit: 300000,
              tokens: {
                input: 150000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const hook = createContextWindowMonitorHook(createMockCtx({ messages }))
    const output = { title: "", output: "tool result", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-5" },
      output
    )

    //#then
    expect(output.output).not.toContain("[Context Status:")
  })
})
