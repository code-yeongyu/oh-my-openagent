import { describe, expect, test } from "bun:test"

import { classifyErrorType, extractAutoRetrySignal, extractStatusCode, isRetryableError } from "./error-classifier"

describe("runtime-fallback error classifier", () => {
  test("detects cooling-down auto-retry status signals", () => {
    //#given
    const info = {
      status:
        "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
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
        "All credentials for model claude-opus-4-6 are cooldown [retrying in 7m 56s attempt #1]",
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
        "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
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
        modelID: "claude-opus-4-6",
        message: "Model not found: anthropic/claude-opus-4-6.",
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
    //#given — status is a string, but error.statusCode is numeric
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

describe("quota error detection (fixes #2747)", () => {
  test("classifies prettified subscription quota error as quota_exceeded", () => {
    //#given
    const error = {
      name: "AI_APICallError",
      message: "Subscription quota exceeded. You can continue using free models.",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [402, 429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })

  test("classifies billing hard limit error as quota_exceeded", () => {
    //#given
    const error = { message: "You have reached your billing hard limit." }

    //#when
    const errorType = classifyErrorType(error)

    //#then
    expect(errorType).toBe("quota_exceeded")
  })

  test("classifies exhausted capacity error as quota_exceeded", () => {
    //#given
    const error = { message: "You have exhausted your capacity on this model." }

    //#when
    const errorType = classifyErrorType(error)

    //#then
    expect(errorType).toBe("quota_exceeded")
  })

  test("classifies out of credits error as quota_exceeded", () => {
    //#given
    const error = { message: "Out of credits. Please add more credits to continue." }

    //#when
    const errorType = classifyErrorType(error)

    //#then
    expect(errorType).toBe("quota_exceeded")
  })

  test("treats HTTP 402 Payment Required as retryable", () => {
    //#given
    const error = { statusCode: 402, message: "Payment Required" }

    //#when
    const retryable = isRetryableError(error, [402, 429, 500, 502, 503, 504])

    //#then
    expect(retryable).toBe(true)
  })

  test("matches subscription quota pattern in RETRYABLE_ERROR_PATTERNS", () => {
    //#given
    const error = { message: "Subscription quota exceeded. You can continue using free models." }

    //#when
    const retryable = isRetryableError(error, [429, 503])

    //#then
    expect(retryable).toBe(true)
  })

  test("classifies QuotaExceededError by errorName even without quota keywords in message", () => {
    //#given
    const error = { name: "QuotaExceededError", message: "Request failed." }

    //#when
    const errorType = classifyErrorType(error)

    //#then
    expect(errorType).toBe("quota_exceeded")
  })

  test("matches payment required pattern directly via RETRYABLE_ERROR_PATTERNS", () => {
    //#given — message has no quota keyword, only "payment required"
    const error = { message: "Error 402: payment required for this request" }

    //#when — classifyErrorType will NOT match (no quota keyword), so isRetryableError must use RETRYABLE_ERROR_PATTERNS
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 503])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })
})
