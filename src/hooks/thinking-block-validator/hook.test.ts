declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: <T>(value: T) => {
  toBe(expected: T): void
  toEqual(expected: unknown): void
  toHaveLength(expected: number): void
}

import { createThinkingBlockValidatorHook } from "./hook"

type TestPart = {
  type: string
  text?: string
  thinking?: string
  signature?: string
  synthetic?: boolean
}

type TestMessage = {
  info: { role: "assistant" | "user" }
  parts: TestPart[]
}

async function runTransform(messages: TestMessage[]): Promise<void> {
  const hook = createThinkingBlockValidatorHook()
  const transform = hook["experimental.chat.messages.transform"]

  if (!transform) {
    throw new Error("missing thinking block validator transform")
  }

  await transform({}, { messages: messages as never })
}

describe("createThinkingBlockValidatorHook", () => {
  it("injects signed thinking history verbatim", async () => {
    //#given
    const signedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "plan",
      signature: "signed-thinking",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [signedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts[0]).toBe(signedThinkingPart)
  })

  it("injects signed redacted_thinking history verbatim", async () => {
    //#given
    const signedRedactedThinkingPart: TestPart = {
      type: "redacted_thinking",
      signature: "signed-redacted-thinking",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [signedRedactedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts[0]).toBe(signedRedactedThinkingPart)
  })

  it("skips hook when history contains reasoning only", async () => {
    //#given
    const reasoningPart: TestPart = {
      type: "reasoning",
      text: "internal reasoning",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [reasoningPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("skips hook when no signed history exists", async () => {
    //#given
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "thinking", thinking: "draft" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("skips hook when history contains synthetic signed blocks only", async () => {
    //#given
    const syntheticSignedPart: TestPart = {
      type: "thinking",
      thinking: "synthetic",
      signature: "synthetic-signature",
      synthetic: true,
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [syntheticSignedPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("does not reinject when the message already starts with redacted_thinking", async () => {
    //#given
    const signedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "plan",
      signature: "signed-thinking",
    }
    const leadingRedactedThinkingPart: TestPart = {
      type: "redacted_thinking",
      signature: "existing-redacted-thinking",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [signedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [leadingRedactedThinkingPart, { type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts[0]).toBe(leadingRedactedThinkingPart)
    expect(messages[1]?.parts).toHaveLength(2)
  })
})
