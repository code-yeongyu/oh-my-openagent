declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: <T>(value: T) => {
  toEqual(expected: unknown): void
  toHaveLength(expected: number): void
}

import { createToolPairValidatorHook } from "./hook"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state/state"

const TOOL_RESULT_PLACEHOLDER = "Tool output unavailable (context compacted)"
const TOOL_RESULT_RECOVERY_CONTINUATION = "Recovered missing tool results. Continue from the repaired tool output."

type TestPart = {
  type: string
  id?: string
  callID?: string
  toolUseId?: string
  tool_use_id?: string
  isError?: boolean
  content?: string | Array<{ type: "text"; text: string }>
  text?: string
  synthetic?: boolean
  state?: { status?: string; output?: string }
}

type TestMessage = {
  info: { role: "assistant" | "user"; sessionID?: string }
  parts: TestPart[]
}

async function runTransform(messages: TestMessage[]): Promise<void> {
  const hook = createToolPairValidatorHook()
  const transform = hook["experimental.chat.messages.transform"]

  if (!transform) {
    throw new Error("missing tool pair validator transform")
  }

  await transform({}, { messages: messages as never })
}

describe("createToolPairValidatorHook", () => {
  it("leaves matching tool pairs unchanged", async () => {
    //#given
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "tool", callID: "call_1" }] },
      { info: { role: "user" }, parts: [{ type: "tool_result", tool_use_id: "call_1", content: "done" }] },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toEqual([
      { info: { role: "assistant" }, parts: [{ type: "tool", callID: "call_1" }] },
      { info: { role: "user" }, parts: [{ type: "tool_result", tool_use_id: "call_1", content: "done" }] },
    ])
  })

  it("leaves terminal OpenCode tool parts unchanged", async () => {
    //#given
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", callID: "call_completed", state: { status: "completed", output: "OK" } },
          { type: "tool", callID: "call_error", state: { status: "error", output: "File not found" } },
        ],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "final answer" }] },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toEqual([
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", callID: "call_completed", state: { status: "completed", output: "OK" } },
          { type: "tool", callID: "call_error", state: { status: "error", output: "File not found" } },
        ],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "final answer" }] },
    ])
  })

  it("injects a missing tool_result into the next user message", async () => {
    //#given
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_1" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_1",
        tool_use_id: "toolu_1",
        isError: true,
        content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
      },
      { type: "text", text: "continue" },
    ])
  })

  it("injects a synthetic user message when the next user message is missing", async () => {
    //#given
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", id: "toolu_1" },
          { type: "text", text: "working" },
          { type: "tool_use", id: "toolu_2" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toEqual([
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", id: "toolu_1" },
          { type: "text", text: "working" },
          { type: "tool_use", id: "toolu_2" },
        ],
      },
      {
        info: { role: "user" },
        parts: [
          {
            type: "tool_result",
            toolUseId: "toolu_1",
            tool_use_id: "toolu_1",
            isError: true,
            content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
          },
          {
            type: "tool_result",
            toolUseId: "toolu_2",
            tool_use_id: "toolu_2",
            isError: true,
            content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
          },
          {
            type: "text",
            text: TOOL_RESULT_RECOVERY_CONTINUATION,
            synthetic: true,
          },
        ],
      },
    ])
  })

  it("injects a synthetic user message before a non-user next message", async () => {
    //#given
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_1" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "follow-up" }] },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages).toEqual([
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_1" }] },
      {
        info: { role: "user" },
        parts: [{
          type: "tool_result",
          toolUseId: "toolu_1",
          tool_use_id: "toolu_1",
          isError: true,
          content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
        }, {
          type: "text",
          text: TOOL_RESULT_RECOVERY_CONTINUATION,
          synthetic: true,
        }],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "follow-up" }] },
    ])
  })

  it("continues validating later assistant turns after inserting a synthetic repair message", async () => {
    //#given
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_1" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "follow-up" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_2" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toEqual([
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_1" }] },
      {
        info: { role: "user" },
        parts: [{
          type: "tool_result",
          toolUseId: "toolu_1",
          tool_use_id: "toolu_1",
          isError: true,
          content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
        }, {
          type: "text",
          text: TOOL_RESULT_RECOVERY_CONTINUATION,
          synthetic: true,
        }],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "follow-up" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_2" }] },
      {
        info: { role: "user" },
        parts: [{
          type: "tool_result",
          toolUseId: "toolu_2",
          tool_use_id: "toolu_2",
          isError: true,
          content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
        }, { type: "text", text: "continue" }],
      },
    ])
  })

  it("injects only the missing tool_results for partial matches", async () => {
    //#given
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use", id: "toolu_1" }, { type: "tool", callID: "call_2" }],
      },
      {
        info: { role: "user" },
        parts: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "done" },
          { type: "text", text: "continue" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "done" },
      {
        type: "tool_result",
        toolUseId: "call_2",
        tool_use_id: "call_2",
        isError: true,
        content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
      },
      { type: "text", text: "continue" },
    ])
  })

  it("leaves tracked subagent sessions unchanged while normal sessions still repair", async () => {
    //#given
    _resetForTesting()
    subagentSessions.add("ses_background_1")
    const backgroundMessages = [
      {
        info: { role: "assistant", sessionID: "ses_background_1" },
        parts: [{ type: "tool_use", id: "toolu_background_1" }],
      },
      {
        info: { role: "assistant", sessionID: "ses_background_1" },
        parts: [{ type: "text", text: "background agent keeps reasoning" }],
      },
    ] satisfies TestMessage[]
    const originalBackgroundMessages = JSON.parse(JSON.stringify(backgroundMessages))
    const mainMessages = [
      {
        info: { role: "assistant", sessionID: "ses_main_1" },
        parts: [{ type: "tool_use", id: "toolu_main_1" }],
      },
      {
        info: { role: "user", sessionID: "ses_main_1" },
        parts: [{ type: "text", text: "continue main session" }],
      },
    ] satisfies TestMessage[]

    try {
      //#when
      await runTransform(backgroundMessages)
      await runTransform(mainMessages)

      //#then
      expect(backgroundMessages).toEqual(originalBackgroundMessages)
      expect(mainMessages[1]?.parts).toEqual([
        {
          type: "tool_result",
          tool_use_id: "toolu_main_1",
          toolUseId: "toolu_main_1",
          isError: true,
          content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
        },
        { type: "text", text: "continue main session" },
      ])
    } finally {
      _resetForTesting()
    }
  })

  it("leaves tracked subagent user turns unchanged when tool_result is missing", async () => {
    //#given
    _resetForTesting()
    subagentSessions.add("ses_background_2")
    const backgroundMessages = [
      {
        info: { role: "assistant", sessionID: "ses_background_2" },
        parts: [{ type: "tool_use", id: "toolu_background_2" }],
      },
      {
        info: { role: "user", sessionID: "ses_background_2" },
        parts: [{ type: "text", text: "continue background session" }],
      },
    ] satisfies TestMessage[]
    const originalBackgroundMessages = JSON.parse(JSON.stringify(backgroundMessages))

    try {
      //#when
      await runTransform(backgroundMessages)

      //#then
      expect(backgroundMessages).toEqual(originalBackgroundMessages)
    } finally {
      _resetForTesting()
    }
  })

  it("treats existing camelCase toolUseId results as already paired", async () => {
    //#given
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_1" }] },
      { info: { role: "user" }, parts: [{ type: "tool_result", toolUseId: "toolu_1", content: [{ type: "text", text: "done" }] }] },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toEqual([
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_1" }] },
      { info: { role: "user" }, parts: [{ type: "tool_result", toolUseId: "toolu_1", content: [{ type: "text", text: "done" }] }] },
    ])
  })
})
