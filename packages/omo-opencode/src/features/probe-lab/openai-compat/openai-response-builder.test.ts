import { describe, expect, test } from "bun:test"
import {
  buildOpenAIResponse,
  buildOpenAIResponseWithToolCalls,
} from "./openai-response-builder"

describe("buildOpenAIResponse", () => {
  describe("#given content + model", () => {
    test("#when built #then returns finish_reason 'stop' and content string", () => {
      const r = buildOpenAIResponse({ content: "hi", model: "deepseek-chat" })
      expect(r.choices[0]!.finish_reason).toBe("stop")
      expect(r.choices[0]!.message.content).toBe("hi")
      expect(r.choices[0]!.message.role).toBe("assistant")
      expect(r.choices[0]!.message.tool_calls).toBeUndefined()
    })
  })
})

describe("buildOpenAIResponseWithToolCalls", () => {
  describe("#given a single tool call without content", () => {
    test("#when built #then content is null, finish_reason 'tool_calls', id format call_<hex>", () => {
      const r = buildOpenAIResponseWithToolCalls({
        toolCalls: [{ name: "get_time", arguments: { tz: "UTC" } }],
        model: "deepseek-chat",
      })
      expect(r.choices[0]!.finish_reason).toBe("tool_calls")
      expect(r.choices[0]!.message.content).toBeNull()
      expect(r.choices[0]!.message.tool_calls).toBeDefined()
      const calls = r.choices[0]!.message.tool_calls!
      expect(calls.length).toBe(1)
      expect(calls[0]!.type).toBe("function")
      expect(calls[0]!.function.name).toBe("get_time")
      expect(calls[0]!.function.arguments).toBe('{"tz":"UTC"}')
      expect(calls[0]!.id).toMatch(/^call_[0-9a-f]{16}$/)
    })
  })

  describe("#given two tool calls", () => {
    test("#when built #then both calls returned with distinct ids", () => {
      const r = buildOpenAIResponseWithToolCalls({
        toolCalls: [
          { name: "a", arguments: { x: 1 } },
          { name: "b", arguments: { y: "z" } },
        ],
        model: "deepseek-chat",
      })
      const calls = r.choices[0]!.message.tool_calls!
      expect(calls.length).toBe(2)
      expect(calls[0]!.id).not.toBe(calls[1]!.id)
      expect(calls[0]!.function.name).toBe("a")
      expect(calls[1]!.function.name).toBe("b")
    })
  })

  describe("#given optional content alongside tool calls", () => {
    test("#when built #then content kept as string", () => {
      const r = buildOpenAIResponseWithToolCalls({
        toolCalls: [{ name: "ping", arguments: {} }],
        model: "deepseek-chat",
        content: "thinking...",
      })
      expect(r.choices[0]!.message.content).toBe("thinking...")
      expect(r.choices[0]!.finish_reason).toBe("tool_calls")
    })
  })

  describe("#given empty tool_calls list", () => {
    test("#when built #then throws (caller must use buildOpenAIResponse)", () => {
      expect(() =>
        buildOpenAIResponseWithToolCalls({
          toolCalls: [],
          model: "deepseek-chat",
        }),
      ).toThrow()
    })
  })
})
