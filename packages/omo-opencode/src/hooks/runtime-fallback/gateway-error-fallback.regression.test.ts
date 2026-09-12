import { describe, expect, test } from "bun:test"

import { classifyErrorType, isRetryableError } from "./error-classifier"

const DEFAULT_RETRY_CODES = [429, 500, 502, 503, 504]

describe("runtime-fallback upstream gateway error regressions", () => {
  test("classifies gateway HTTP 400 openai_error as upstream_gateway_error and fallback-eligible", () => {
    //#given
    const error = {
      name: "openai_error",
      statusCode: 400,
      message: "upstream gateway error: upstream channel failed",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, DEFAULT_RETRY_CODES)

    //#then
    expect(errorType).toBe("upstream_gateway_error")
    // fallback-to-next-model semantics, NOT same-model retry
    expect(retryable).toBe(true)
  })

  test("classifies nested gateway 400 openai_error as upstream_gateway_error", () => {
    //#given
    const error = {
      error: {
        name: "openai_error",
        statusCode: 400,
        message: "upstream channel error",
      },
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, DEFAULT_RETRY_CODES)

    //#then
    expect(errorType).toBe("upstream_gateway_error")
    expect(retryable).toBe(true)
  })

  test("keeps gateway 500 openai_error on the existing 5xx-retry-safe path", () => {
    //#given
    const error = {
      name: "openai_error",
      statusCode: 500,
      message: "upstream gateway error",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, DEFAULT_RETRY_CODES)

    //#then
    expect(errorType).toBe("upstream_gateway_error")
    expect(retryable).toBe(true)
  })

  test("treats openai_error without a status as non-retryable (conservative)", () => {
    //#given
    const error = {
      name: "openai_error",
      message: "upstream gateway error",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, DEFAULT_RETRY_CODES)

    //#then
    expect(errorType).toBe("upstream_gateway_error")
    expect(retryable).toBe(false)
  })

  test("keeps genuine HTTP 400 client errors non-retryable", () => {
    //#given
    const error = {
      name: "ValidationError",
      statusCode: 400,
      message: "Invalid request payload",
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, DEFAULT_RETRY_CODES)

    //#then
    expect(errorType).toBeUndefined()
    expect(retryable).toBe(false)
  })
})
