declare const require: (name: string) => any
const { describe, expect, test, beforeEach, mock } = require("bun:test")

const readConnectedProvidersCacheMock = mock(() => null)

mock.module("./connected-providers-cache", () => ({
  readConnectedProvidersCache: readConnectedProvidersCacheMock,
}))

import { shouldRetryError, selectFallbackProvider } from "./model-error-classifier"

describe("model-error-classifier", () => {
  beforeEach(() => {
    readConnectedProvidersCacheMock.mockReturnValue(null)
    readConnectedProvidersCacheMock.mockClear()
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
        "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("selectFallbackProvider prefers first connected provider in preference order", () => {
    //#given
    readConnectedProvidersCacheMock.mockReturnValue(["anthropic", "nvidia"])

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider falls back to next connected provider when first is disconnected", () => {
    //#given
    readConnectedProvidersCacheMock.mockReturnValue(["nvidia"])

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
    readConnectedProvidersCacheMock.mockReturnValue(["provider-x"])

    //#when
    const provider = selectFallbackProvider(["provider-y"], "provider-x")

    //#then
    expect(provider).toBe("provider-x")
  })

  test("treats FreeUsageLimitError (PascalCase name) as retryable by name", () => {
    //#given
    const error = { name: "FreeUsageLimitError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats freeusagelimiterror (lowercase name) as retryable by name", () => {
    //#given
    const error = { name: "freeusagelimiterror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })
})
