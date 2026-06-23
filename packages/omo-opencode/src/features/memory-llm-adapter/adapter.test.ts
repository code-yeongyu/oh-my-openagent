import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createChatCompletionsHandler } from "./adapter"
import { resolveClaudeMemLlmAdapterConfig } from "./config"

const tempRoots: string[] = []
function makeConfigPath(content: object, apiKey: string): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-mem-adapter-"))
  tempRoots.push(dir)
  const keyPath = join(dir, "opencode-go.key")
  writeFileSync(keyPath, apiKey)
  const cfgPath = join(dir, "opencode-go-config.json")
  writeFileSync(cfgPath, JSON.stringify({ apiKeyFile: keyPath, ...content }))
  return cfgPath
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("resolveClaudeMemLlmAdapterConfig", () => {
  test("uses opencode-go defaults when only API key is provided", () => {
    const config = resolveClaudeMemLlmAdapterConfig(
      { CLAUDE_MEM_OPENCODE_GO_API_KEY: "sk-test" },
      join(tmpdir(), "non-existent-adapter-config.json"),
    )

    expect(config.host).toBe("127.0.0.1")
    expect(config.port).toBe(37999)
    expect(config.endpoint).toBe("http://127.0.0.1:20128/v1/chat/completions")
    expect(config.apiKey).toBe("sk-test")
    expect(config.primaryModel).toBe("deepseek-v4-flash")
    expect(config.fallbackModel).toBe("deepseek-v4-flash")
  })

  test("reads endpoint and models from opencode-go config file", () => {
    const path = makeConfigPath(
      {
        endpoint: "https://example.test/zen/go/v1/chat/completions",
        model: "kimi-k2.5",
        fallbackModel: "minimax-m3",
      },
      "sk-file-key",
    )
    const config = resolveClaudeMemLlmAdapterConfig({}, path)

    expect(config.endpoint).toBe("https://example.test/zen/go/v1/chat/completions")
    expect(config.primaryModel).toBe("kimi-k2.5")
    expect(config.fallbackModel).toBe("minimax-m3")
    expect(config.apiKey).toBe("sk-file-key")
  })
})

describe("createChatCompletionsHandler", () => {
  test("routes to opencode-go primary model by default", async () => {
    let capturedUrl = ""
    let capturedInit: RequestInit | undefined

    const handler = createChatCompletionsHandler({
      config: resolveClaudeMemLlmAdapterConfig(
        { CLAUDE_MEM_OPENCODE_GO_API_KEY: "sk-primary" },
        join(tmpdir(), "non-existent-adapter-config.json"),
      ),
      fetchImpl: async (input, init) => {
        capturedUrl = input.toString()
        capturedInit = init
        return new Response(
          JSON.stringify({
            id: "chatcmpl-1",
            choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      },
    })

    const response = await handler(
      new Request("http://127.0.0.1:37999/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "ignored-by-adapter",
          messages: [{ role: "user", content: "hello" }],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(capturedUrl).toBe("http://127.0.0.1:20128/v1/chat/completions")

    const headers = new Headers(capturedInit?.headers)
    expect(headers.get("authorization")).toBe("Bearer sk-primary")

    const body = JSON.parse(capturedInit?.body as string) as Record<string, unknown>
    expect(body.model).toBe("deepseek-v4-flash")
    expect(body.messages).toEqual([{ role: "user", content: "hello" }])
    expect(body.stream).toBe(false)
  })

  test("falls back to fallbackModel when primary fails", async () => {
    const attemptedModels: string[] = []

    const path = makeConfigPath(
      { model: "kimi-k2.5", fallbackModel: "minimax-m3" },
      "sk-fallback",
    )
    const handler = createChatCompletionsHandler({
      config: resolveClaudeMemLlmAdapterConfig({}, path),
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(init?.body as string) as { model: string }
        attemptedModels.push(body.model)
        if (body.model === "kimi-k2.5") {
          return new Response(JSON.stringify({ error: { message: "primary failed" } }), { status: 500 })
        }
        return new Response(
          JSON.stringify({
            id: "chatcmpl-2",
            choices: [{ index: 0, message: { role: "assistant", content: "fallback ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      },
    })

    const response = await handler(
      new Request("http://127.0.0.1:37999/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
    )

    expect(response.status).toBe(200)
    expect(attemptedModels).toEqual(["kimi-k2.5", "minimax-m3"])
    await expect(response.json()).resolves.toEqual({
      id: "chatcmpl-2",
      choices: [{ index: 0, message: { role: "assistant", content: "fallback ok" } }],
    })
  })

  test("skips fallback attempt when primary equals fallback model", async () => {
    let callCount = 0
    const handler = createChatCompletionsHandler({
      config: resolveClaudeMemLlmAdapterConfig(
        { CLAUDE_MEM_OPENCODE_GO_API_KEY: "sk-single" },
        join(tmpdir(), "non-existent-adapter-config.json"),
      ),
      fetchImpl: async () => {
        callCount++
        return new Response(JSON.stringify({ error: { message: "always fails" } }), { status: 500 })
      },
    })

    const response = await handler(
      new Request("http://127.0.0.1:37999/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
    )

    expect(response.status).toBe(502)
    expect(callCount).toBe(1)
  })

  test("returns 502 when every provider attempt fails", async () => {
    const path = makeConfigPath(
      { model: "kimi-k2.5", fallbackModel: "minimax-m3" },
      "sk-everyone-fails",
    )
    const handler = createChatCompletionsHandler({
      config: resolveClaudeMemLlmAdapterConfig({}, path),
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 }),
    })

    const response = await handler(
      new Request("http://127.0.0.1:37999/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: {
        message: expect.stringContaining("All claude-mem adapter providers failed"),
      },
    })
  })
})
