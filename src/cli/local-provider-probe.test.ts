import { afterEach, describe, expect, it, mock } from "bun:test"
import { probeLocalProviders } from "./local-provider-probe"

describe("probeLocalProviders", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("parses LMStudio OpenAI-compatible /models response", async () => {
    //#given
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { id: "devstral-small", context_length: 32768, max_output_tokens: 4096 },
              { id: "qwen3-coder" },
            ],
          }),
      } as Response)
    ) as unknown as typeof fetch

    //#when
    const result = await probeLocalProviders({
      lmstudioUrl: "http://127.0.0.1:1234/v1",
    })

    //#then
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe("lmstudio")
    expect(result[0].warning).toBeUndefined()
    expect(result[0].models.map((model) => model.id)).toEqual(["devstral-small", "qwen3-coder"])
    expect(result[0].models[0].contextLength).toBe(32768)
    expect(result[0].models[0].outputLength).toBe(4096)
  })

  it("parses Ollama /api/tags response", async () => {
    //#given
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              {
                name: "qwen3-coder:32b",
                details: {
                  parameter_size: "32B",
                  context_length: 65536,
                },
              },
            ],
          }),
      } as Response)
    ) as unknown as typeof fetch

    //#when
    const result = await probeLocalProviders({
      ollamaUrl: "http://localhost:11434",
    })

    //#then
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe("ollama")
    expect(result[0].warning).toBeUndefined()
    expect(result[0].models).toHaveLength(1)
    expect(result[0].models[0].id).toBe("qwen3-coder:32b")
    expect(result[0].models[0].parameterSize).toBe("32B")
    expect(result[0].models[0].contextLength).toBe(65536)
  })

  it("returns warning and empty model list when endpoint is unreachable", async () => {
    //#given
    globalThis.fetch = mock(() => Promise.reject(new Error("connection refused"))) as unknown as typeof fetch

    //#when
    const result = await probeLocalProviders({
      vllmUrl: "http://localhost:8000/v1",
    })

    //#then
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe("vllm")
    expect(result[0].models).toEqual([])
    expect(result[0].warning).toContain("connection refused")
  })

  it("handles malformed responses without throwing", async () => {
    //#given
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ nope: true }),
      } as Response)
    ) as unknown as typeof fetch

    //#when
    const result = await probeLocalProviders({
      lmstudioUrl: "http://127.0.0.1:1234/v1",
    })

    //#then
    expect(result).toHaveLength(1)
    expect(result[0].models).toEqual([])
    expect(result[0].warning).toBe("Malformed model list response")
  })
})
