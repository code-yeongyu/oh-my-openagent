declare const require: (name: string) => any
const { describe, expect, test, beforeEach, afterEach, mock, spyOn } = require("bun:test")
import * as connectedProvidersCache from "./connected-providers-cache"

let readConnectedProvidersCacheSpy: ReturnType<typeof spyOn> | undefined
const { shouldRetryError, selectFallbackProvider, isRetryableModelError } = await import("./model-error-classifier")

describe("model-error-classifier", () => {
  beforeEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
  })

  afterEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = undefined
  })

  test("treats overloaded retry messages as retryable", () => {
    //#given
    const error = { message: "Provider is overloaded" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats cooling-down auto-retry messages as retryable", () => {
    //#given
    const error = {
      message:
        "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~5 days attempt #1]",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("selectFallbackProvider prefers first connected provider in preference order", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["anthropic", "nvidia"])

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider falls back to next connected provider when first is disconnected", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["nvidia"])

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"])

    //#then
    expect(provider).toBe("nvidia")
  })

  test("selectFallbackProvider uses provider preference order when cache is missing", () => {
    //#given - no cache file

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider uses connected preferred provider when fallback providers are unavailable", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["provider-x"])

    //#when
    const provider = selectFallbackProvider(["provider-y"], "provider-x")

    //#then
    expect(provider).toBe("provider-x")
  })

  test("treats provider usage limit reached message as retryable fallback signal", () => {
    //#given
    const error = { message: "usage limit has been reached for your account" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats 'bad request' message as retryable (GitHub Copilot rolling update)", () => {
    //#given
    const error = { message: "400 Bad Request" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats 'bad request' lowercase as retryable", () => {
    //#given
    const error = { message: "bad request: model temporarily unavailable" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats localized transient provider messages as retryable", () => {
    //#given
    const errors = [
      { message: "请求过于频繁，请稍后重试" },
      { message: "服务暂时不可用" },
      { message: "触发频率限制" },
    ]

    //#when
    const results = errors.map((error) => shouldRetryError(error))

    //#then
    expect(results).toEqual([true, true, true])
  })

  test("treats HTTP 429 rate limit message as retryable", () => {
    //#given
    const error = { message: "429 Too Many Requests: rate limit reached" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats forbidden provider message as retryable", () => {
    //#given
    const error = { message: "Forbidden: Selected provider is forbidden" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("does not treat unrelated forbidden messages as retryable", () => {
    //#given
    const error = { message: "EACCES: forbidden write to /etc/hosts" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("does not treat unrelated 403 messages as retryable", () => {
    //#given
    const error = { message: "Tool returned HTTP 403 for the requested URL" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("GLM 429 rate limit with statusCode and Chinese message triggers fallback (statusCode check)", () => {
    //#given
    const error = { statusCode: 429, message: "请求频率过高" }

    //#when
    const result = isRetryableModelError(error)

    //#then
    expect(result).toBe(true)
  })

  test("GLM 429 rate limit with statusCode and no message at all triggers fallback", () => {
    //#given
    const error = { statusCode: 429 }

    //#when
    const result = isRetryableModelError(error)

    //#then
    expect(result).toBe(true)
  })

  test("GLM 503 service unavailable with statusCode triggers fallback", () => {
    //#given
    const error = { statusCode: 503, message: "Service Unavailable" }

    //#when
    const result = isRetryableModelError(error)

    //#then
    expect(result).toBe(true)
  })

  test("GLM 529 overloaded with statusCode triggers fallback", () => {
    //#given
    const error = { statusCode: 529 }

    //#when
    const result = isRetryableModelError(error)

    //#then
    expect(result).toBe(true)
  })

  test("HTTP 400 with statusCode does NOT trigger fallback via statusCode alone (400 excluded)", () => {
    //#given — message does NOT match any retryable pattern
    const error = { statusCode: 400, message: "Invalid parameter: model_name" }

    //#when
    const result = isRetryableModelError(error)

    //#then
    expect(result).toBe(false)
  })

  test("HTTP 401 with statusCode does NOT trigger fallback (not a rate limit)", () => {
    //#given
    const error = { statusCode: 401, message: "Unauthorized" }

    //#when
    const result = isRetryableModelError(error)

    //#then
    expect(result).toBe(false)
  })

  test("rate limit message without statusCode still works (backward compat)", () => {
    //#given
    const error = { message: "rate limit reached for requests" }

    //#when
    const result = isRetryableModelError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats OpenAI streaming server_error envelopes as retryable (issue #3799)", () => {
    //#given: OpenAI surfaces its mid-stream error with type 'server_error'
    const error = {
      name: undefined,
      message: "{\"error\":{\"type\":\"server_error\",\"message\":\"server_error\"}}",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats the OpenAI prose 'An error occurred while processing' message as retryable (issue #3799)", () => {
    //#given: the human-readable prose surfaced when OpenAI's stream fails
    const error = {
      name: undefined,
      message: "An error occurred while processing your request. Please try again later.",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats 'upstream request failed' provider error as retryable (issue #6313)", () => {
    //#given
    const error = { message: "Error from provider (Console Go): Upstream request failed" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })
})

export {}
