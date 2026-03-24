const { describe, expect, test } = require("bun:test")

const { createThinkingBlockValidatorHook } = require("./hook")

type TestPart = {
  type: string
  id: string
  text?: string
  thinking?: string
  data?: string
  signature?: string
}

type TestMessage = {
  info: {
    role: string
    id?: string
    modelID?: string
  }
  parts: TestPart[]
}

function createMessage(info: TestMessage["info"], parts: TestPart[]): TestMessage {
  return { info, parts }
}

function createTextPart(id: string, text: string): TestPart {
  return { type: "text", id, text }
}

function createSignedThinkingPart(id: string, thinking: string, signature: string): TestPart {
  return { type: "thinking", id, thinking, signature }
}

function createRedactedThinkingPart(id: string, signature: string): TestPart {
  return { type: "redacted_thinking", id, data: "encrypted", signature }
}

describe("createThinkingBlockValidatorHook", () => {
  test("reuses the previous signed thinking part verbatim when assistant content lacks a leading thinking block", async () => {
    const transform = Reflect.get(createThinkingBlockValidatorHook(), "experimental.chat.messages.transform")
    expect(typeof transform).toBe("function")

    const previousThinkingPart = createSignedThinkingPart("prt_prev_signed", "prior reasoning", "sig_prev")
    const targetTextPart = createTextPart("prt_target_text", "tool result")
    const messages: TestMessage[] = [
      createMessage({ role: "user", modelID: "claude-opus-4-6-thinking" }, [createTextPart("prt_user_text", "continue")]),
      createMessage({ role: "assistant", id: "msg_prev" }, [previousThinkingPart, createTextPart("prt_prev_text", "done")]),
      createMessage({ role: "assistant", id: "msg_target" }, [targetTextPart]),
    ]

    await Reflect.apply(transform, undefined, [{}, { messages }])

    expect(messages[2]?.parts[0]).toBe(previousThinkingPart)
    expect(messages[2]?.parts).toEqual([previousThinkingPart, targetTextPart])
  })

  test("skips injection when no signed Anthropic thinking part exists in history", async () => {
    const transform = Reflect.get(createThinkingBlockValidatorHook(), "experimental.chat.messages.transform")
    expect(typeof transform).toBe("function")

    const targetTextPart = createTextPart("prt_target_text", "tool result")
    const messages: TestMessage[] = [
      createMessage({ role: "user", modelID: "claude-opus-4-6-thinking" }, [createTextPart("prt_user_text", "continue")]),
      createMessage({ role: "assistant", id: "msg_prev" }, [{ type: "reasoning", id: "prt_reason", text: "gpt reasoning" }]),
      createMessage({ role: "assistant", id: "msg_target" }, [targetTextPart]),
    ]

    await Reflect.apply(transform, undefined, [{}, { messages }])

    expect(messages[2]?.parts).toEqual([targetTextPart])
  })

  test("does not inject when the assistant message already starts with redacted thinking", async () => {
    const transform = Reflect.get(createThinkingBlockValidatorHook(), "experimental.chat.messages.transform")
    expect(typeof transform).toBe("function")

    const existingThinkingPart = createRedactedThinkingPart("prt_redacted", "sig_redacted")
    const targetTextPart = createTextPart("prt_target_text", "tool result")
    const messages: TestMessage[] = [
      createMessage({ role: "user", modelID: "claude-opus-4-6-thinking" }, [createTextPart("prt_user_text", "continue")]),
      createMessage({ role: "assistant", id: "msg_target" }, [existingThinkingPart, targetTextPart]),
    ]

    await Reflect.apply(transform, undefined, [{}, { messages }])

    expect(messages[1]?.parts).toEqual([existingThinkingPart, targetTextPart])
  })

  test("skips processing for models without extended thinking", async () => {
    const transform = Reflect.get(createThinkingBlockValidatorHook(), "experimental.chat.messages.transform")
    expect(typeof transform).toBe("function")

    const previousThinkingPart = createSignedThinkingPart("prt_prev_signed", "prior reasoning", "sig_prev")
    const targetTextPart = createTextPart("prt_target_text", "tool result")
    const messages: TestMessage[] = [
      createMessage({ role: "user", modelID: "gpt-5.4" }, [createTextPart("prt_user_text", "continue")]),
      createMessage({ role: "assistant", id: "msg_prev" }, [previousThinkingPart]),
      createMessage({ role: "assistant", id: "msg_target" }, [targetTextPart]),
    ]

    await Reflect.apply(transform, undefined, [{}, { messages }])

    expect(messages[2]?.parts).toEqual([targetTextPart])
  })
})

export {}
