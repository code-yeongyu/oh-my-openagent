import { describe, expect, test } from "bun:test"

import { classifyErrorType, isRetryableError } from "./error-classifier"

describe("runtime-fallback quota error regressions", () => {
  test("classifies subscription quota errors as quota_exceeded and triggers fallback", () => {
    //#given
    const error = {
      name: "AI_APICallError",
      message: "Subscription quota exceeded. You can continue using free models.",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    // quota exhaustion should trigger fallback to the next model
    expect(retryable).toBe(true)
  })

  test("treats HTTP 402 payment required as fallback-eligible", () => {
    //#given
    const error = { statusCode: 402, message: "Payment Required" }

    //#when
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    // payment failure triggers fallback to a different provider/model
    expect(retryable).toBe(true)
  })

  test("keeps HTTP 429 rate limit retryable", () => {
    //#given
    const error = { statusCode: 429, message: "Too Many Requests: rate limit reached" }

    //#when
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(retryable).toBe(true)
  })

  test("classifies quota error names as quota_exceeded and triggers fallback", () => {
    //#given
    const error = { name: "QuotaExceededError", message: "Request failed." }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    // quota errors trigger fallback to next configured model
    expect(retryable).toBe(true)
  })

  test("classifies Volcano Engine 'exceeded the usage quota' as quota_exceeded and retryable", () => {
    //#given
    const error = {
      name: "SessionRetry",
      message: "You have exceeded the 5-hour usage quota. It will reset at 2026-05-11 01:20:12 +0800 CST. We recommend using a different model.",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    // Volcano Engine quota errors trigger fallback to the next model
    expect(retryable).toBe(true)
  })

  test("classifies UnifyLLM pre-charge balance failures as quota_exceeded", () => {
    //#given
    const error = {
      message:
        "预扣费额度失败, 用户剩余额度: 0.265718, 需要预扣费额度: 0.680208 (request id: test-request-id)",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })

  test("classifies Google RESOURCE_EXHAUSTED (gRPC code 8) as quota_exceeded via error name only", () => {
    //#given
    // Bare provider error: only the error name carries the quota signal.
    // Message is intentionally generic so the test fails if the new
    // `resourceexhausted` name allow-list entry is removed.
    const error = {
      name: "RESOURCE_EXHAUSTED",
      message: "Request failed.",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })

  test("classifies Google ResourceExhausted message without HTTP status as quota_exceeded", () => {
    //#given
    const error = {
      name: "GoogleGenerativeAIError",
      message: "Resource exhausted: Please try again later.",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })

  test("classifies snake_case OpenAI insufficient_quota error name as quota_exceeded via name only", () => {
    //#given
    // Bare provider error: only the snake_case error name carries the quota signal.
    // Message is intentionally generic so the test fails if the underscore
    // normalization (`insufficient_quota` -> `insufficientquota`) regresses.
    const error = {
      name: "insufficient_quota",
      message: "Request failed.",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })
})
