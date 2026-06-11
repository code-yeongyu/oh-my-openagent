import { describe, expect, it } from "bun:test"
import {
  injectTargetKeywordMessages,
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
    const system = await handlers.get("before_agent_start")?.(
      { prompt: "[search-mode]\nfind it", systemPrompt: ["base"] },
      {},
    )
    expect(system).toMatchObject({ systemPrompt: expect.any(Array) })
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
