import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test"
import { generateProviderConfig } from "./generate-llmgateway-secondary-provider"

const TEST_API_KEY = "llmgtwy_test_for_unittest_only"

interface LlmModel {
  id: string
  name: string
}

interface LlmModelsResponse {
  data: LlmModel[]
}

function makeMockResponse(models: LlmModel[]): Response {
  const body: LlmModelsResponse = { data: models }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const originalFetch = globalThis.fetch

describe("generate-llmgateway-secondary-provider", () => {
  beforeEach(() => {
    globalThis.fetch = mock()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("generateProviderConfig", () => {
    test("returns provider keyed by llmgateway-secondary", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      mockFetch.mockResolvedValueOnce(makeMockResponse([{ id: "gpt-4o-mini", name: "GPT-4o Mini" }]))

      // when
      const result = await generateProviderConfig(TEST_API_KEY)

      // then
      expect(result).toHaveProperty("provider")
      expect(result.provider).toHaveProperty("llmgateway-secondary")
    })

    test("sets npm to @ai-sdk/openai-compatible", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      mockFetch.mockResolvedValueOnce(makeMockResponse([{ id: "gpt-4o-mini", name: "GPT-4o Mini" }]))

      // when
      const result = await generateProviderConfig(TEST_API_KEY)

      // then
      expect(result.provider["llmgateway-secondary"].npm).toBe("@ai-sdk/openai-compatible")
    })

    test("sets name to LLM Gateway (secondary)", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      mockFetch.mockResolvedValueOnce(makeMockResponse([{ id: "gpt-4o-mini", name: "GPT-4o Mini" }]))

      // when
      const result = await generateProviderConfig(TEST_API_KEY)

      // then
      expect(result.provider["llmgateway-secondary"].name).toBe("LLM Gateway (secondary)")
    })

    test("sets baseURL to https://api.llmgateway.io/v1", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      mockFetch.mockResolvedValueOnce(makeMockResponse([{ id: "gpt-4o-mini", name: "GPT-4o Mini" }]))

      // when
      const result = await generateProviderConfig(TEST_API_KEY)

      // then
      expect(result.provider["llmgateway-secondary"].options.baseURL).toBe("https://api.llmgateway.io/v1")
    })

    test("sets apiKey from the env var argument, not hardcoded", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      mockFetch.mockResolvedValueOnce(makeMockResponse([{ id: "gpt-4o-mini", name: "GPT-4o Mini" }]))

      // when
      const result = await generateProviderConfig(TEST_API_KEY)

      // then
      expect(result.provider["llmgateway-secondary"].options.apiKey).toBe(TEST_API_KEY)
      expect(result.provider["llmgateway-secondary"].options.apiKey).not.toBe("llmgtwy_V5QeetWrPCSzyIY537hfXaPztLIwDrkNAbDTLoDA")
    })

    test("uses minimal model entries with empty objects", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      mockFetch.mockResolvedValueOnce(
        makeMockResponse([
          { id: "gpt-4o-mini", name: "GPT-4o Mini" },
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        ])
      )

      // when
      const result = await generateProviderConfig(TEST_API_KEY)

      // then
      const models = result.provider["llmgateway-secondary"].models
      expect(models).toEqual({
        "claude-sonnet-4-5": {},
        "gpt-4o-mini": {},
      })
    })

    test("sorts models alphabetically by id", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      const unsorted = [
        { id: "z-model", name: "Z Model" },
        { id: "a-model", name: "A Model" },
        { id: "m-model", name: "M Model" },
      ]
      mockFetch.mockResolvedValueOnce(makeMockResponse(unsorted))

      // when
      const result = await generateProviderConfig(TEST_API_KEY)

      // then
      const modelIds = Object.keys(result.provider["llmgateway-secondary"].models)
      expect(modelIds).toEqual(["a-model", "m-model", "z-model"])
    })

    test("output is deterministic: same input produces same output", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      const models = [
        { id: "gpt-5-mini", name: "GPT-5 Mini" },
        { id: "gpt-4o-mini", name: "GPT-4o Mini" },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      ]

      // when
      mockFetch.mockResolvedValueOnce(makeMockResponse(models))
      const result1 = await generateProviderConfig(TEST_API_KEY)

      mockFetch.mockResolvedValueOnce(makeMockResponse(models))
      const result2 = await generateProviderConfig(TEST_API_KEY)

      // then
      expect(result1).toEqual(result2)
    })

    test("calls the correct API endpoint with auth header", async () => {
      // given
      const mockFetch = globalThis.fetch as ReturnType<typeof mock>
      mockFetch.mockResolvedValueOnce(makeMockResponse([{ id: "gpt-4o-mini", name: "GPT-4o Mini" }]))

      // when
      await generateProviderConfig(TEST_API_KEY)

      // then
      const callArgs = mockFetch.mock.calls[0]
      const [url, options] = callArgs as [string, RequestInit]
      const urlObj = new URL(url)
      expect(urlObj.origin).toBe("https://api.llmgateway.io")
      expect(urlObj.pathname).toBe("/v1/models")
      expect(options.headers).toBeDefined()
      const headers = options.headers as Record<string, string>
      expect(headers["Authorization"]).toBe(`Bearer ${TEST_API_KEY}`)
    })
  })
})
