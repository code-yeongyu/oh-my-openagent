declare const require: (name: string) => any
const { describe, expect, test, beforeEach, afterEach, mock, spyOn } = require("bun:test")
import * as connectedProvidersCache from "./connected-providers-cache"

let readConnectedProvidersCacheSpy: ReturnType<typeof spyOn> | undefined
const { shouldRetryError, selectFallbackProvider } = await import("./model-error-classifier")

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
        "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
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

  test("treats QuotaExceededError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "QuotaExceededError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats quotaexceedederror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "quotaexceedederror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats InsufficientCreditsError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "InsufficientCreditsError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats insufficientcreditserror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "insufficientcreditserror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats FreeUsageLimitError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "FreeUsageLimitError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats freeusagelimiterror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "freeusagelimiterror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
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

  describe("#given message-only errors with quota/billing language", () => {
    test("#when message contains 'quota' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "You have exceeded your quota for this billing period" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when message contains 'quota will reset after' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "Request failed: quota will reset after 2026-04-10" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when message contains 'usage limit' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "Your usage limit has been reached for today" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when message contains 'insufficient' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "Insufficient credits to complete request" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when message contains 'free usage' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "Free usage exceeded, please upgrade your plan" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when message contains 'credit' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "Not enough credit remaining on your account" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when message contains 'balance' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "Your account balance is too low" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when message contains 'usage exceeded' #then classifies as non-retryable", () => {
      //#given
      const error = { message: "API usage exceeded for this billing cycle" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("#when error has unknown name and quota message #then stop pattern takes precedence", () => {
      //#given
      const error = { name: "UnknownProviderError", message: "quota exceeded for model" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })
  })
})

export {}
