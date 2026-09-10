import { describe, expect, test } from "bun:test"

import { isRuntimeFallbackRetryableError } from "./runtime-fallback-error-classifier"

const DEFAULT_RETRY_CODES = [429, 500, 502, 503, 504] as const

describe("runtime fallback content filter errors", () => {
  test("retries provider ContentFilterError payloads without broadening validation errors", () => {
    //#given
    const errors = [
      {
        name: "ContentFilterError",
        message: "The response was blocked by the provider's content filter",
      },
      {
        name: "ValidationError",
        statusCode: 400,
        message: "Invalid request payload",
      },
    ] as const

    //#when
    const retryable = errors.map((error) =>
      isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES),
    )

    //#then
    expect(retryable).toEqual([true, false])
  })
})
