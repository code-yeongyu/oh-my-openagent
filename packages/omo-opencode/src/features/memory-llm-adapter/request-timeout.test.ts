import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createChatCompletionsHandler } from "./adapter"
import { resolveClaudeMemLlmAdapterConfig } from "./config"
import type { ClaudeMemLlmAdapterFetch } from "./types"

function makeConfig() {
  return {
    ...resolveClaudeMemLlmAdapterConfig(
      {
        CLAUDE_MEM_OPENCODE_GO_API_KEY: "sk-timeout-test",
        CLAUDE_MEM_OPENCODE_GO_MODEL: "primary-model",
        CLAUDE_MEM_OPENCODE_GO_FALLBACK_MODEL: "fallback-model",
      },
      join(tmpdir(), "non-existent-timeout-config.json"),
    ),
    requestTimeoutMs: 1,
  }
}

describe("Claude Mem LLM adapter request timeout", () => {
  test("aborts each provider attempt after the configured timeout", async () => {
    const attemptedSignals: AbortSignal[] = []
    const fetchImpl: ClaudeMemLlmAdapterFetch = async (_input, init) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) {
        return new Response("missing abort signal", { status: 599 })
      }
      attemptedSignals.push(signal)
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
      return new Response("unreachable", { status: 200 })
    }

    const handler = createChatCompletionsHandler({
      config: makeConfig(),
      fetchImpl,
    })

    const response = await handler(
      new Request("http://127.0.0.1:37999/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
    )

    expect(response.status).toBe(502)
    expect(attemptedSignals).toHaveLength(2)
    const responseBody = await response.json()
    expect(responseBody).toEqual({
      error: {
        message: expect.stringContaining("timed out after 1ms"),
      },
    })
  })

  test("aborts provider attempts when response bodies never finish", async () => {
    const fetchImpl: ClaudeMemLlmAdapterFetch = async () => {
      return new Response(
        new ReadableStream({
          start() {},
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      )
    }

    const handler = createChatCompletionsHandler({
      config: makeConfig(),
      fetchImpl,
    })

    const response = await Promise.race([
      handler(
        new Request("http://127.0.0.1:37999/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
        }),
      ),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("handler did not timeout stalled response body")), 80)
      }),
    ])

    expect(response.status).toBe(502)
    const responseBody = await response.json()
    expect(responseBody).toEqual({
      error: {
        message: expect.stringContaining("timed out after 1ms"),
      },
    })
  })
})
