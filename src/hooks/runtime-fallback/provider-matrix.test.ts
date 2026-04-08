import { describe, expect, test } from "bun:test"

import { classifyErrorType, isRetryableError } from "./error-classifier"

describe("runtime-fallback provider matrix quota tests", () => {
  describe("OpenAI provider", () => {
    test("classifies OpenAI insufficient_quota error as quota_exceeded", () => {
      //#given
      const error = {
        name: "InsufficientQuotaError",
        message: "You exceeded your current quota. Please check your plan and billing details.",
        provider: "openai",
      }

      //#when
      const errorType = classifyErrorType(error)
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(errorType).toBe("quota_exceeded")
      expect(retryable).toBe(false)
    })

    test("classifies OpenAI billing_hard_limit error as quota_exceeded", () => {
      //#given
      const error = {
        name: "BillingError",
        message: "Billing hard limit reached. You have exceeded your hard limit.",
        provider: "openai",
      }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })

    test("classifies OpenAI rate limit as retryable", () => {
      //#given
      const error = {
        name: "RateLimitError",
        statusCode: 429,
        message: "Rate limit reached for requests",
        provider: "openai",
      }

      //#when
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(retryable).toBe(true)
    })
  })

  describe("Anthropic provider", () => {
    test("classifies Anthropic quota exceeded as non-retryable", () => {
      //#given
      const error = {
        name: "QuotaExceededError",
        message: "Your account has exceeded its quota. Please upgrade your plan.",
        provider: "anthropic",
      }

      //#when
      const errorType = classifyErrorType(error)
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(errorType).toBe("quota_exceeded")
      expect(retryable).toBe(false)
    })

    test("classifies Anthropic subscription quota as non-retryable", () => {
      //#given
      const error = {
        name: "AI_APICallError",
        message: "Subscription quota exceeded. You can continue using free models.",
        provider: "anthropic",
      }

      //#when
      const errorType = classifyErrorType(error)
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(errorType).toBe("quota_exceeded")
      expect(retryable).toBe(false)
    })

    test("classifies Anthropic cooling down with retry signal as retryable (auto-retry pattern)", () => {
      //#given
      const error = {
        name: "AI_APICallError",
        message: "All credentials for model claude-opus-4-6 are cooling down [retrying in ~2 weeks]",
        provider: "anthropic",
      }

      //#when
      const errorType = classifyErrorType(error)
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(errorType).toBeUndefined()
      expect(retryable).toBe(true)
    })
  })

  describe("Google/Gemini provider", () => {
    test("classifies Google API key missing as missing_api_key", () => {
      //#given
      const error = {
        name: "AI_LoadAPIKeyError",
        message:
          "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
        provider: "google",
      }

      //#when
      const errorType = classifyErrorType(error)
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(errorType).toBe("missing_api_key")
      expect(retryable).toBe(true)
    })

    test("classifies Google quota exceeded as quota_exceeded", () => {
      //#given
      const error = {
        name: "QuotaExceededError",
        message: "Quota exceeded for quota metric 'Generate Content API requests'",
        provider: "google",
      }

      //#when
      const errorType = classifyErrorType(error)
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(errorType).toBe("quota_exceeded")
      expect(retryable).toBe(false)
    })

    test("classifies Google rate limit exceeded as retryable", () => {
      //#given
      const error = {
        name: "ResourceExhausted",
        statusCode: 429,
        message: "Rate limit exceeded. Please try again later.",
        provider: "google",
      }

      //#when
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(retryable).toBe(true)
    })
  })

  describe("Generic provider patterns", () => {
    test("classifies exhausted capacity as quota_exceeded", () => {
      //#given
      const error = {
        message: "Sorry, you've exhausted your capacity",
      }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })

    test("classifies out of credits as quota_exceeded", () => {
      //#given
      const error = {
        message: "You are out of credits. Please purchase more.",
      }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })

    test("classifies payment required (402) as quota_exceeded", () => {
      //#given
      const error = {
        statusCode: 402,
        message: "Payment Required",
      }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })

    test("classifies out of credits as quota_exceeded", () => {
      //#given
      const error = {
        message: "You are out of credits. Please purchase more.",
      }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })

    test("classifies exhausted capacity as quota_exceeded", () => {
      //#given
      const error = {
        message: "Sorry, you've exhausted your capacity",
      }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })
  })

  describe("Provider-specific error name patterns", () => {
    test("classifies BillingError as quota_exceeded", () => {
      //#given
      const error = { name: "BillingError", message: "Billing issue" }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })

    test("classifies InsufficientQuota as quota_exceeded", () => {
      //#given
      const error = { name: "InsufficientQuota", message: "Not enough quota" }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })

    test("classifies QuotaExceeded as quota_exceeded", () => {
      //#given
      const error = { name: "QuotaExceeded", message: "Quota limit reached" }

      //#when
      const errorType = classifyErrorType(error)

      //#then
      expect(errorType).toBe("quota_exceeded")
    })
  })

  describe("HTTP status code matrix", () => {
    test("429 rate limit is retryable", () => {
      //#given
      const error = { statusCode: 429, message: "Too many requests" }

      //#when
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(retryable).toBe(true)
    })

    test("402 payment required is NOT retryable", () => {
      //#given
      const error = { statusCode: 402, message: "Payment Required" }

      //#when
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(retryable).toBe(false)
    })

    test("500 server error is retryable", () => {
      //#given
      const error = { statusCode: 500, message: "Internal Server Error" }

      //#when
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(retryable).toBe(true)
    })

    test("503 service unavailable is retryable", () => {
      //#given
      const error = { statusCode: 503, message: "Service Unavailable" }

      //#when
      const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

      //#then
      expect(retryable).toBe(true)
    })
  })
})
