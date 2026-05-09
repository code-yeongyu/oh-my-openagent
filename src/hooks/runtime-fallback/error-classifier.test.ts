import { describe, expect, test } from "bun:test"

import { classifyErrorType, extractAutoRetrySignal, extractStatusCode, isHardFailure, isRetryableError } from "./error-classifier"

describe("runtime-fallback error classifier", () => {
  test("detects cooling-down auto-retry status signals", () => {
    //#given
    const info = {
      status:
        "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~5 days attempt #1]",
    }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeDefined()
  })

  test("detects single-word cooldown auto-retry status signals", () => {
    //#given
    const info = {
      status:
        "All credentials for model claude-opus-4-7 are cooldown [retrying in 7m 56s attempt #1]",
    }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeDefined()
  })

  test("detects too-many-requests auto-retry status signals without countdown text", () => {
    //#given
    const info = {
      status:
        "Too Many Requests: Sorry, you've exhausted this model's rate limit. Please try a different model.",
    }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeDefined()
  })

  test("treats cooling-down retry messages as retryable", () => {
    //#given
    const error = {
      message:
        "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~5 days attempt #1]",
    }

    //#when
    const retryable = isRetryableError(error, [400, 403, 408, 429, 500, 502, 503, 504, 529])

    //#then
    expect(retryable).toBe(true)
  })

  test("classifies ProviderModelNotFoundError as model_not_found", () => {
    //#given
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "anthropic",
        modelID: "claude-opus-4-7",
        message: "Model not found: anthropic/claude-opus-4-7.",
      },
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(errorType).toBe("model_not_found")
    expect(retryable).toBe(true)
  })

  test("classifies nested AI_LoadAPIKeyError as missing_api_key", () => {
    //#given
    const error = {
      data: {
        name: "AI_LoadAPIKeyError",
        message:
          "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
      },
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(errorType).toBe("missing_api_key")
    expect(retryable).toBe(true)
  })

  test("ignores non-retry assistant status text", () => {
    //#given
    const info = {
      status: "Thinking...",
    }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeUndefined()
  })
})

describe("extractStatusCode", () => {
  test("extracts numeric statusCode from top-level", () => {
    expect(extractStatusCode({ statusCode: 429 })).toBe(429)
  })

  test("extracts numeric status from top-level", () => {
    expect(extractStatusCode({ status: 503 })).toBe(503)
  })

  test("extracts statusCode from nested data", () => {
    expect(extractStatusCode({ data: { statusCode: 500 } })).toBe(500)
  })

  test("extracts statusCode from nested error", () => {
    expect(extractStatusCode({ error: { statusCode: 502 } })).toBe(502)
  })

  test("extracts statusCode from nested cause", () => {
    expect(extractStatusCode({ cause: { statusCode: 504 } })).toBe(504)
  })

  test("skips non-numeric status and finds deeper numeric statusCode", () => {
    //#given - status is a string, but error.statusCode is numeric
    const error = {
      status: "error",
      error: { statusCode: 429 },
    }

    //#when
    const code = extractStatusCode(error)

    //#then
    expect(code).toBe(429)
  })

  test("skips non-numeric statusCode string and finds numeric in cause", () => {
    const error = {
      statusCode: "UNKNOWN",
      status: "failed",
      cause: { statusCode: 503 },
    }

    expect(extractStatusCode(error)).toBe(503)
  })

  test("returns undefined when no numeric status exists", () => {
    expect(extractStatusCode({ status: "error", message: "something broke" })).toBeUndefined()
  })

  test("returns undefined for null/undefined error", () => {
    expect(extractStatusCode(null)).toBeUndefined()
    expect(extractStatusCode(undefined)).toBeUndefined()
  })

  test("falls back to regex match in error message", () => {
    const error = { message: "Request failed with status code 429" }
    expect(extractStatusCode(error, [429, 503])).toBe(429)
  })

  test("prefers top-level numeric over nested numeric", () => {
    const error = {
      statusCode: 400,
      error: { statusCode: 429 },
      cause: { statusCode: 503 },
    }
    expect(extractStatusCode(error)).toBe(400)
  })
})

describe("model support fallback", () => {
  test("detects model_not_supported errors as retryable for fallback chain", () => {
    //#given
    const error1 = { message: "model_not_supported" }
    const error2 = { message: "The model 'gpt-4-foo' is not supported by this API" }
    const error3 = { message: "model not supported on free tier" }

    //#when
    const retryable1 = isRetryableError(error1, [400, 404])
    const retryable2 = isRetryableError(error2, [400, 404])
    const retryable3 = isRetryableError(error3, [400, 404])

    //#then
    expect(retryable1).toBe(true)
    expect(retryable2).toBe(true)
    expect(retryable3).toBe(true)
  })
})

describe("isHardFailure", () => {
  test("classifies quota_exceeded as hard failure", () => {
    const error = { name: "QuotaExceededError", message: "Quota exceeded for this month" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("classifies insufficient balance as hard failure", () => {
    const error = { message: "Insufficient balance to fulfill request" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("classifies model_not_found as hard failure", () => {
    const error = { name: "ProviderModelNotFoundError", message: "Model not found: anthropic/claude-opus-4-7" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("classifies model_not_supported as hard failure", () => {
    const error = { message: "model_not_supported" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("classifies missing_api_key as hard failure", () => {
    const error = { name: "AI_LoadAPIKeyError", message: "API key is missing. Pass it via the environment variable" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("classifies HTTP 401 as hard failure", () => {
    const error = { statusCode: 401, message: "Unauthorized" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("classifies HTTP 403 as hard failure", () => {
    const error = { statusCode: 403, message: "Forbidden" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("classifies HTTP 404 as hard failure", () => {
    const error = { statusCode: 404, message: "Not found" }
    expect(isHardFailure(error)).toBe(true)
  })

  test("does NOT classify HTTP 429 as hard failure", () => {
    const error = { statusCode: 429, message: "Too Many Requests" }
    expect(isHardFailure(error)).toBe(false)
  })

  test("does NOT classify HTTP 503 as hard failure", () => {
    const error = { statusCode: 503, message: "Service Unavailable" }
    expect(isHardFailure(error)).toBe(false)
  })

  test("does NOT classify HTTP 502/504 as hard failure", () => {
    expect(isHardFailure({ statusCode: 502, message: "Bad Gateway" })).toBe(false)
    expect(isHardFailure({ statusCode: 504, message: "Gateway Timeout" })).toBe(false)
  })

  test("does NOT classify 'retrying in' as hard failure", () => {
    const error = {
      message: "All credentials for model claude-opus-4-7 are cooling down [retrying in 7m attempt #1]",
    }
    expect(isHardFailure(error)).toBe(false)
  })

  test("does NOT classify plain rate_limit as hard failure", () => {
    expect(isHardFailure({ message: "rate_limit hit" })).toBe(false)
    expect(isHardFailure({ message: "Rate limit exceeded, try again later" })).toBe(false)
  })

  test("does NOT classify synthesized ProviderRateLimitError as hard failure", () => {
    const error = { name: "ProviderRateLimitError", message: "All credentials for model X are cooling down" }
    expect(isHardFailure(error)).toBe(false)
  })

  test("does NOT classify generic 'overloaded' or 'try again' as hard failure", () => {
    expect(isHardFailure({ message: "Provider overloaded" })).toBe(false)
    expect(isHardFailure({ message: "Service temporarily unavailable, try again" })).toBe(false)
  })
})
