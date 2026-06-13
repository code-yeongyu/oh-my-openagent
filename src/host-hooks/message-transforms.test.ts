import { describe, expect, it } from "bun:test"
import {
  injectTargetKeywordMessages,
  injectTargetKeywordMessagesIntoContext,
  registerTargetMessageTransforms,
  validateTargetMessages,
  type TargetMessageTransformApi,
} from "./message-transforms"

describe("target message transforms", () => {
  it("#given mode keywords #when target input is transformed #then each supported route injects its mode block", () => {
    expect(injectTargetKeywordMessages("ultrawork finish this")).toContain("<ultrawork-mode>")
    expect(injectTargetKeywordMessages("search for the source")).toContain("[search-mode]")
    expect(injectTargetKeywordMessages("analyze the failure")).toContain("[analyze-mode]")
    expect(injectTargetKeywordMessages("team mode investigate this")).toContain("[team-mode]")
  })

  it("#given a Pi mode prompt #when transforms run #then input and system prompt keep Pi result shapes", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown | Promise<unknown>>()
    const api: TargetMessageTransformApi = {
      on: (event, handler) => {
        handlers.set(event, handler)
      },
    }
    registerTargetMessageTransforms("pi", api)

    const input = await handlers.get("input")?.(
      { text: "ultrawork finish this", source: "interactive" },
      {},
    )
    expect(input).toMatchObject({ action: "transform" })
    const transformedText = (input as { text: string }).text
    const system = await handlers.get("before_agent_start")?.(
      { prompt: transformedText, systemPrompt: "base" },
      {},
    )
    expect(system).toMatchObject({ systemPrompt: expect.any(String) })
  })

  it("#given an Oh My Pi mode prompt #when transforms run #then its array system prompt shape is preserved", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown | Promise<unknown>>()
    const api: TargetMessageTransformApi = {
      on: (event, handler) => {
        handlers.set(event, handler)
      },
    }
    registerTargetMessageTransforms("oh-my-pi", api)
    const input = await handlers.get("input")?.(
      { text: "search for it", source: "interactive" },
      {},
    )
    expect(input).toMatchObject({ text: expect.stringContaining("[search-mode]") })
    const system = await handlers.get("before_agent_start")?.(
      { prompt: "search for it", systemPrompt: ["base"] },
      {},
    )
    expect(system).toMatchObject({ systemPrompt: expect.any(Array) })
  })

  it("#given a headless user prompt #when context is transformed #then the latest user text receives the mode block immutably", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "old message" }] },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: [{ type: "text", text: "ultrawork finish this" }] },
    ]
    const before = structuredClone(messages)

    const transformed = injectTargetKeywordMessagesIntoContext(messages)

    expect(transformed).not.toBe(messages)
    expect((transformed[2] as { content: Array<{ text: string }> }).content[0]?.text).toContain("<ultrawork-mode>")
    expect(messages).toEqual(before)
  })

  it("#given an already injected or slash-command prompt #when context is transformed #then no duplicate mode block is added", () => {
    const injected = injectTargetKeywordMessages("search for it")
    const messages = [
      { role: "user", content: [{ type: "text", text: "/search for it" }] },
      { role: "user", content: [{ type: "text", text: injected }] },
    ]

    const transformed = injectTargetKeywordMessagesIntoContext(messages)
    const text = (transformed[1] as { content: Array<{ text: string }> }).content[0]?.text ?? ""

    expect(text.match(/\[search-mode\]/g)?.length).toBe(1)
    expect((transformed[0] as { content: Array<{ text: string }> }).content[0]?.text).toBe("/search for it")
  })

  it("#given target provider messages #when validators run #then tool pairs and thinking blocks are observed without mutating payload", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reason" },
          { type: "toolCall", id: "call-1", name: "read", arguments: {} },
        ],
      },
      { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "ok" }] },
    ]
    const before = structuredClone(messages)

    expect(validateTargetMessages(messages)).toEqual({
      assistantMessages: 1,
      thinkingBlocks: 1,
      toolCalls: 1,
      toolResults: 1,
      missingToolResults: [],
    })
    expect(messages).toEqual(before)
  })
})
