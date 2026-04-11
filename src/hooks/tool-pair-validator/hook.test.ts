declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: <T>(value: T) => {
  toEqual(expected: unknown): void
  toHaveLength(expected: number): void
}

import { createToolPairValidatorHook } from "./hook"

const TOOL_RESULT_PLACEHOLDER = "Tool output unavailable (context compacted)"

type TestPart = {
  type: string
  id?: string
  callID?: string
  tool_use_id?: string
  content?: string
  text?: string
}

type TestMessage = {
  info: { role: "assistant" | "user" }
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
      { type: "tool_result", tool_use_id: "toolu_1", content: TOOL_RESULT_PLACEHOLDER },
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
          { type: "tool_result", tool_use_id: "toolu_1", content: TOOL_RESULT_PLACEHOLDER },
          { type: "tool_result", tool_use_id: "toolu_2", content: TOOL_RESULT_PLACEHOLDER },
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
        parts: [{ type: "tool_result", tool_use_id: "toolu_1", content: TOOL_RESULT_PLACEHOLDER }],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "follow-up" }] },
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
      { type: "tool_result", tool_use_id: "call_2", content: TOOL_RESULT_PLACEHOLDER },
      { type: "text", text: "continue" },
    ])
  })
})
