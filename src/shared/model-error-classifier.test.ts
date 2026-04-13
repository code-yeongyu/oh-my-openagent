declare const require: (name: string) => any
const { describe, expect, test, beforeEach, afterEach, mock, spyOn } = require("bun:test")
import * as connectedProvidersCache from "./connected-providers-cache"

let readConnectedProvidersCacheSpy: ReturnType<typeof spyOn> | undefined
const { shouldRetryError, isRetryableModelError, isStopModelError, selectFallbackProvider } = await import("./model-error-classifier")

describe("model-error-classifier", () => {
  beforeEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
  })

  afterEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = undefined
  })

  describe("#shouldRetryError", () => {
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

    test("treats HTTP 429 rate limit message as retryable", () => {
      //#given
      const error = { message: "429 Too Many Requests: rate limit reached" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for QuotaExceededError (provider exhausted, different provider may work)", () => {
      //#given
      const error = { name: "QuotaExceededError" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for InsufficientCreditsError", () => {
      //#given
      const error = { name: "InsufficientCreditsError" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for FreeUsageLimitError", () => {
      //#given
      const error = { name: "FreeUsageLimitError" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for quota reset message", () => {
      //#given
      const error = { message: "quota will reset after 1 hour" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for quota exceeded message", () => {
      //#given
      const error = { message: "quota exceeded for this billing period" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for 'usage limit has been reached' message", () => {
      //#given
      const error = { message: "The usage limit has been reached for your account" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for insufficient credits message", () => {
      //#given
      const error = { message: "insufficient credits to complete this request" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for subscription quota message", () => {
      //#given
      const error = { message: "Subscription quota exceeded. You can continue using free models." }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("triggers fallback for spending cap message", () => {
      //#given
      const error = { message: "Your project has exceeded its monthly spending cap" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns false for MessageAbortedError (non-retryable)", () => {
      //#given
      const error = { name: "MessageAbortedError" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for ContextLengthError (non-retryable)", () => {
      //#given
      const error = { name: "ContextLengthError" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for ValidationError (non-retryable)", () => {
      //#given
      const error = { name: "ValidationError" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for unknown error with no matching pattern", () => {
      //#given
      const error = { message: "some completely unrelated error" }

      //#when
      const result = shouldRetryError(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#isRetryableModelError", () => {
    test("returns true for RateLimitError", () => {
      //#given
      const error = { name: "RateLimitError" }

      //#when
      const result = isRetryableModelError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns false for QuotaExceededError (STOP, not retryable on same provider)", () => {
      //#given
      const error = { name: "QuotaExceededError" }

      //#when
      const result = isRetryableModelError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for usage limit message (STOP, not retryable on same provider)", () => {
      //#given
      const error = { message: "usage limit has been reached for your account" }

      //#when
      const result = isRetryableModelError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for MessageAbortedError (non-retryable)", () => {
      //#given
      const error = { name: "MessageAbortedError" }

      //#when
      const result = isRetryableModelError(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#isStopModelError", () => {
    test("returns true for QuotaExceededError", () => {
      //#given
      const error = { name: "QuotaExceededError" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for quotaexceedederror (lowercase)", () => {
      //#given
      const error = { name: "quotaexceedederror" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for InsufficientCreditsError", () => {
      //#given
      const error = { name: "InsufficientCreditsError" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for FreeUsageLimitError", () => {
      //#given
      const error = { name: "FreeUsageLimitError" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for 'usage limit has been reached' message", () => {
      //#given
      const error = { message: "The usage limit has been reached" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for quota exceeded message", () => {
      //#given
      const error = { message: "quota exceeded for this billing period" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns false for spending cap message (retryable, not stop)", () => {
      //#given
      const error = { message: "exceeded its monthly spending cap" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for RateLimitError (retryable, not stop)", () => {
      //#given
      const error = { name: "RateLimitError" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for MessageAbortedError (non-retryable, not stop)", () => {
      //#given
      const error = { name: "MessageAbortedError" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for unknown error with no stop pattern", () => {
      //#given
      const error = { message: "some random error" }

      //#when
      const result = isStopModelError(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#selectFallbackProvider", () => {
    test("prefers first connected provider in preference order", () => {
      //#given
      readConnectedProvidersCacheSpy?.mockReturnValue(["anthropic", "nvidia"])

      //#when
      const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

      //#then
      expect(provider).toBe("anthropic")
    })

    test("falls back to next connected provider when first is disconnected", () => {
      //#given
      readConnectedProvidersCacheSpy?.mockReturnValue(["nvidia"])

      //#when
      const provider = selectFallbackProvider(["anthropic", "nvidia"])

      //#then
      expect(provider).toBe("nvidia")
    })

    test("uses provider preference order when cache is missing", () => {
      //#given - no cache file

      //#when
      const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

      //#then
      expect(provider).toBe("anthropic")
    })

    test("uses connected preferred provider when fallback providers are unavailable", () => {
      //#given
      readConnectedProvidersCacheSpy?.mockReturnValue(["provider-x"])

      //#when
      const provider = selectFallbackProvider(["provider-y"], "provider-x")

      //#then
      expect(provider).toBe("provider-x")
    })
  })
})

export {}
