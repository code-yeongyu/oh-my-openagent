import { describe, expect, test } from "bun:test"
import { stream as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages"
import { stream as openaiStream } from "@earendil-works/pi-ai/api/openai-completions"

import { toGenAiModel, toGenAiUsage } from "./gen-ai-attributes"

// Real senpi parser branches (anthropic-messages message_start; openai-completions chunk usage/model),
// driven through injected clients so no network is touched.

type SseEvent = readonly [string, Record<string, unknown>]

function anthropicSse(model: string): string {
  const events: SseEvent[] = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } }],
    ["message_stop", { type: "message_stop" }],
  ]
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("")
}

function modelSpec(id: string, provider: string, api: string, allowedFallbackModels?: readonly string[]) {
  return {
    id, name: id, api, provider, baseUrl: "https://provider.invalid", reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 1_000,
    ...(allowedFallbackModels === undefined ? {} : { compat: { allowedFallbackModels } }),
  }
}

const CONTEXT = { messages: [{ role: "user", content: "hi", timestamp: 0 }] }

async function anthropicTurn(requested: string, reported: string, fallbacks?: readonly string[]) {
  const client = {
    beta: { messages: { create: () => ({ asResponse: async () => new Response(anthropicSse(reported), { headers: { "content-type": "text/event-stream" } }) }) } },
  }
  type Args = Parameters<typeof anthropicStream>
  // A partial model and an injected client are enough for the real stream parser.
  const model = modelSpec(requested, "anthropic", "anthropic-messages", fallbacks) as unknown as Args[0]
  return await anthropicStream(model, CONTEXT as unknown as Args[1], { client } as unknown as Args[2]).result()
}

async function openaiTurn(chunks: readonly Record<string, unknown>[]) {
  type Args = Parameters<typeof openaiStream>
  const model = modelSpec("gpt-6-sol", "openai", "openai-completions") as unknown as Args[0]
  const sse = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join("")
  const fetch = async () => new Response(sse, { headers: { "content-type": "text/event-stream" } })
  // An injected fetch replaces the HTTP transport; the parser is senpi's own.
  return await openaiStream(model, CONTEXT as unknown as Args[1], { fetch, apiKey: "test-key" } as unknown as Args[2]).result()
}

describe("toGenAiUsage", () => {
  test("#given senpi's Anthropic usage #then input is inclusive of cache reads and writes, output passes through, total is omo's", async () => {
    const message = await anthropicTurn("claude-opus-5-5", "claude-opus-5-5")
    expect(message.usage).toMatchObject({ input: 100, cacheRead: 30, cacheWrite: 20, output: 40, totalTokens: 190 })
    expect(toGenAiUsage(message.usage)).toEqual({
      "gen_ai.usage.input_tokens": 150,
      "gen_ai.usage.cache_read.input_tokens": 30,
      "gen_ai.usage.cache_creation.input_tokens": 20,
      "gen_ai.usage.output_tokens": 40,
      "omo.usage.total_tokens": 190,
    })
  })

  test("#given senpi's OpenAI usage #then the inclusive input equals the provider's prompt_tokens and output includes reasoning", async () => {
    const message = await openaiTurn([
      { id: "c1", model: "gpt-6-sol", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] },
      { id: "c1", model: "gpt-6-sol", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 150, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 12 } } },
    ])
    expect(message.usage).toMatchObject({ input: 100, cacheRead: 30, cacheWrite: 20, output: 40, reasoning: 12 })
    expect(toGenAiUsage(message.usage)).toMatchObject({
      "gen_ai.usage.input_tokens": 150,
      "gen_ai.usage.output_tokens": 40,
      "gen_ai.usage.reasoning.output_tokens": 12,
      "omo.usage.total_tokens": 190,
    })
  })
})

describe("toGenAiModel", () => {
  test("#given a reported model that is not an allowed fallback #then omo.model_id keeps the request and the response names the reported model", async () => {
    const message = await anthropicTurn("claude-opus-5-5", "claude-sonnet-5-5")
    expect(toGenAiModel(message, "claude-opus-5-5")).toEqual({
      "omo.provider": "anthropic",
      "gen_ai.provider.name": "anthropic",
      "omo.model_id": "claude-opus-5-5",
      "gen_ai.response.model": "claude-sonnet-5-5",
      "gen_ai.request.model": "claude-opus-5-5",
    })
    expect(toGenAiModel(message)["gen_ai.request.model"]).toBe("claude-opus-5-5")
  })

  test("#given an allowed fallback the parser promoted #then omo.model_id is the promoted model and the request stays the requested id", async () => {
    const message = await anthropicTurn("claude-opus-5-5", "claude-sonnet-5-5", ["claude-sonnet-5-5"])
    expect(message.model).toBe("claude-sonnet-5-5")
    expect(toGenAiModel(message, "claude-opus-5-5")).toMatchObject({
      "omo.model_id": "claude-sonnet-5-5",
      "gen_ai.response.model": "claude-sonnet-5-5",
      "gen_ai.request.model": "claude-opus-5-5",
    })
    // Without the configured id a promotion leaves the request unknown: it is never copied from the response.
    expect(toGenAiModel(message)).not.toHaveProperty("gen_ai.request.model")
  })

  test("#given a reported id equal to the request #then all three ids are equal", async () => {
    const message = await anthropicTurn("claude-opus-5-5", "claude-opus-5-5")
    expect(toGenAiModel(message, "claude-opus-5-5")).toMatchObject({
      "omo.model_id": "claude-opus-5-5",
      "gen_ai.response.model": "claude-opus-5-5",
      "gen_ai.request.model": "claude-opus-5-5",
    })
  })

  test("#given a provider that reports no model name #then there is no gen_ai.response.model", async () => {
    const message = await openaiTurn([
      { id: "c1", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
    ])
    expect(message.responseModel).toBeUndefined()
    const attributes = toGenAiModel(message)
    expect(attributes).not.toHaveProperty("gen_ai.response.model")
    expect(attributes).toMatchObject({ "omo.model_id": "gpt-6-sol", "gen_ai.request.model": "gpt-6-sol", "gen_ai.provider.name": "openai" })
  })

  test("#given ids outside the vocabulary and a private provider #then every path is masked, and google/xai use their GenAI values", () => {
    expect(toGenAiModel({ api: "anthropic-messages", provider: "my-gateway", model: "secret-finetune", responseModel: "other-secret" }, "secret-finetune")).toEqual({
      "omo.provider": "custom",
      "gen_ai.provider.name": "custom",
      "omo.model_id": "custom",
      "gen_ai.response.model": "custom",
      "gen_ai.request.model": "custom",
    })
    expect(toGenAiModel({ provider: "google", model: "gemini-3.1-pro" })["gen_ai.provider.name"]).toBe("gcp.gemini")
    expect(toGenAiModel({ provider: "xai", model: "grok-4.7" })["gen_ai.provider.name"]).toBe("x_ai")
  })
})
