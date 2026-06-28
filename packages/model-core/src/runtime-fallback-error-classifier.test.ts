import { describe, expect, test } from "bun:test"

import {
  classifyRuntimeFallbackError,
  classifyRuntimeFallbackErrorResult,
  extractRuntimeFallbackAutoRetrySignal,
  getRuntimeFallbackErrorMessage,
  getRuntimeFallbackStatusCode,
  isRuntimeFallbackRetryableError,
} from "./runtime-fallback-error-classifier"

const DEFAULT_RETRY_CODES = [429, 500, 502, 503, 504] as const

describe("runtime fallback error classifier", () => {
  test("classifies representative Anthropic provider payloads without adapter state", () => {
    //#given
    const cases = [
      {
        label: "anthropic 429 rate limit",
        error: {
          name: "AI_APICallError",
          statusCode: 429,
          message: "Too Many Requests: rate limit reached for anthropic/claude-sonnet-4-6",
        },
        expectedType: undefined,
        expectedRetryable: true,
        expectedStatusCode: 429,
      },
      {
        label: "anthropic 503 service unavailable",
        error: {
          error: {
            name: "AI_APICallError",
            statusCode: 503,
            message: "Service Unavailable",
          },
        },
        expectedType: undefined,
        expectedRetryable: true,
        expectedStatusCode: 503,
      },
      {
        label: "anthropic quota exhaustion",
        error: {
          data: {
            error: {
              name: "QuotaExceededError",
              message: "Subscription quota exceeded. You can continue using free models.",
            },
          },
        },
        expectedType: "quota_exceeded",
        expectedRetryable: true,
        expectedStatusCode: undefined,
      },
      {
        label: "anthropic abort",
        error: {
          name: "MessageAbortedError",
          message: "The user aborted this request.",
        },
        expectedType: "abort",
        expectedRetryable: false,
        expectedStatusCode: undefined,
      },
      {
        label: "anthropic unrelated validation error",
        error: {
          name: "ValidationError",
          statusCode: 400,
          message: "Invalid request payload",
        },
        expectedType: undefined,
        expectedRetryable: false,
        expectedStatusCode: 400,
      },
    ] as const

    //#when
    const results = cases.map(({ error, ...metadata }) => ({
      ...metadata,
      actualType: classifyRuntimeFallbackError(error),
      actualRetryable: isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES),
      actualStatusCode: getRuntimeFallbackStatusCode(error, DEFAULT_RETRY_CODES),
    }))

    //#then
    for (const result of results) {
      expect(result.actualType, result.label).toBe(result.expectedType)
      expect(result.actualRetryable, result.label).toBe(result.expectedRetryable)
      expect(result.actualStatusCode, result.label).toBe(result.expectedStatusCode)
    }
  })

  test("preserves malformed provider payload classification behavior", () => {
    //#given
    const malformedPayloads = [
      null,
      undefined,
      { statusCode: "429", message: 429 },
      { data: { error: { name: 7, message: false } } },
      { data: { error: null }, error: "broken" },
    ]

    //#when
    const results = malformedPayloads.map((error) => ({
      message: getRuntimeFallbackErrorMessage(error),
      statusCode: getRuntimeFallbackStatusCode(error, DEFAULT_RETRY_CODES),
      type: classifyRuntimeFallbackError(error),
      retryable: isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES),
    }))

    //#then
    expect(results).toEqual([
      { message: "", statusCode: undefined, type: undefined, retryable: false },
      { message: "", statusCode: undefined, type: undefined, retryable: false },
      { message: "{\"statuscode\":\"429\",\"message\":429}", statusCode: 429, type: undefined, retryable: true },
      { message: "{\"data\":{\"error\":{\"name\":7,\"message\":false}}}", statusCode: undefined, type: undefined, retryable: false },
      { message: "{\"data\":{\"error\":null},\"error\":\"broken\"}", statusCode: undefined, type: undefined, retryable: false },
    ])
  })

  test("honors retryable AI SDK signals only for safe status codes", () => {
    //#given
    const cases = [
      {
        error: { error: { statusCode: 524, isRetryable: true, message: "Cloudflare timeout" } },
        expected: true,
      },
      {
        error: { error: { statusCode: 401, isRetryable: true, message: "Unauthorized" } },
        expected: false,
      },
      {
        error: { error: { isRetryable: true, message: "connection reset before response body arrived" } },
        expected: true,
      },
    ] as const

    //#when
    const retryable = cases.map(({ error }) =>
      isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES),
    )

    //#then
    expect(retryable).toEqual(cases.map(({ expected }) => expected))
  })

  test("extracts provider auto-retry signals from status summary or details", () => {
    //#given
    const retryInfo = {
      summary: "All credentials for model claude-opus-4-7 are cooling down [retrying in 7m 56s attempt #1]",
    }

    //#when
    const signal = extractRuntimeFallbackAutoRetrySignal(retryInfo)

    //#then
    expect(signal).toEqual({ signal: retryInfo.summary })
  })

  test("returns a structured result while preserving current string and retry classifiers", () => {
    //#given
    const cases = [
      {
        label: "429 rate limit",
        error: { statusCode: 429, message: "Too Many Requests: rate limit reached" },
        expectedLegacyType: undefined,
        expectedRetryable: true,
        expectedResult: { kind: "rate_limit", retryable: true, providerExhausted: false },
      },
      {
        label: "quota exhausted",
        error: { name: "QuotaExceededError", message: "Subscription quota exceeded" },
        expectedLegacyType: "quota_exceeded",
        expectedRetryable: true,
        expectedResult: { kind: "quota_exceeded", retryable: true, providerExhausted: true },
      },
      {
        label: "localized quota exhausted",
        error: { message: "预扣费额度失败，用户剩余额度不足，需要预扣费额度" },
        expectedLegacyType: "quota_exceeded",
        expectedRetryable: true,
        expectedResult: { kind: "quota_exceeded", retryable: true, providerExhausted: true },
      },
      {
        label: "provider auto-retry",
        error: {
          status:
            "All credentials for model claude-opus-4-7 are cooling down [retrying in 7m 56s attempt #1]",
        },
        expectedLegacyType: undefined,
        expectedRetryable: true,
        expectedResult: { kind: "provider_auto_retry", retryable: true, providerExhausted: true },
      },
      {
        label: "auth failure",
        error: { statusCode: 401, message: "Unauthorized: invalid bearer token" },
        expectedLegacyType: undefined,
        expectedRetryable: false,
        expectedResult: { kind: "auth_failure", retryable: false, providerExhausted: false },
      },
      {
        label: "unknown network",
        error: { message: "Network error: ENOTFOUND provider.example" },
        expectedLegacyType: undefined,
        expectedRetryable: false,
        expectedResult: { kind: "network", retryable: false, providerExhausted: false },
      },
    ] as const

    //#when
    const results = cases.map(({ error, ...metadata }) => ({
      ...metadata,
      legacyType: classifyRuntimeFallbackError(error),
      retryable: isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES),
      structured: classifyRuntimeFallbackErrorResult(error, DEFAULT_RETRY_CODES),
    }))

    //#then
    for (const result of results) {
      expect(result.legacyType, result.label).toBe(result.expectedLegacyType)
      expect(result.retryable, result.label).toBe(result.expectedRetryable)
      expect(result.structured, result.label).toEqual(result.expectedResult)
    }
  })
})
