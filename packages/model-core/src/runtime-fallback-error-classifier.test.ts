import { describe, expect, test } from "bun:test"

import {
  classifyRuntimeFallbackError,
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

  test("treats free usage exceeded messages as retryable runtime fallback errors", () => {
    //#given
    const error = { message: "Free usage exceeded, subscribe to Go" }

    //#when
    const retryable = isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES)
    const type = classifyRuntimeFallbackError(error)

    //#then
    expect(retryable).toBe(true)
    expect(type).toBeUndefined()
  })

  test("leaves OpenCode context overflow to native compaction", () => {
    //#given
    const error = {
      name: "ContextOverflowError",
      data: {
        message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
        responseBody:
          '{"error":{"message":"Your input exceeds the context window of this model. Please adjust your input and try again.","type":"invalid_request_error","code":"context_too_large"}}',
      },
    }

    //#when
    const type = classifyRuntimeFallbackError(error)
    const retryable = isRuntimeFallbackRetryableError(error, [400, ...DEFAULT_RETRY_CODES])

    //#then
    expect(type).toBe("context_overflow")
    expect(retryable).toBe(false)
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

  test("#given terminal quota in data detail #when classified #then aborts without retry", () => {
    // given
    const error = {
      data: {
        detail: {
          error: {
            type: "terminal_quota_exhausted",
          },
        },
      },
    }

    // when
    const type = classifyRuntimeFallbackError(error)
    const retryable = isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES)

    // then
    expect(type).toBe("abort")
    expect(retryable).toBe(false)
  })

  test("#given a ModelNotFoundError terminal quota wrapper #when classified #then aborts without retry", () => {
    // given
    const error = {
      name: "ModelNotFoundError",
      message: "Terminal quota exceeded for the requested model",
    }

    // when
    const type = classifyRuntimeFallbackError(error)
    const retryable = isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES)

    // then
    expect(type).toBe("abort")
    expect(retryable).toBe(false)
  })

  test.each([
    "non-terminal quota exceeded",
    "non-terminal billing limit reached",
  ])("#given %s #when classified #then remains retryable", (message) => {
    // given
    const error = {
      name: "QuotaExceededError",
      message,
    }

    // when
    const type = classifyRuntimeFallbackError(error)
    const retryable = isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES)

    // then
    expect(type).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })

  test("#given a throwing detail getter #when classified #then property access failure is conservative", () => {
    // given
    const error = {
      message: "Invalid request payload",
      get detail(): unknown {
        throw new Error("detail getter failed")
      },
    }

    // when / then
    expect(() => classifyRuntimeFallbackError(error)).not.toThrow()
    expect(classifyRuntimeFallbackError(error)).toBeUndefined()
    expect(isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES)).toBe(false)
  })

  test("#given a root Proxy with a throwing get trap #when classified #then shared property access is conservative", () => {
    // given
    const error = new Proxy(
      {},
      {
        get(): never {
          throw new Error("root get trap failed")
        },
      },
    )

    // when / then
    expect(() => classifyRuntimeFallbackError(error)).not.toThrow()
    expect(() => isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES)).not.toThrow()
    expect(classifyRuntimeFallbackError(error)).toBeUndefined()
    expect(isRuntimeFallbackRetryableError(error, DEFAULT_RETRY_CODES)).toBe(false)
  })

  test("classifies terminal_quota_exhausted detail as abort (non-retryable)", () => {
    const cases = [
      {
        label: "structured terminal_quota_exhausted detail with standard message",
        error: {
          detail: {
            error: {
              type: "terminal_quota_exhausted",
              message: "Terminal quota or billing limit reached for the requested LiteLLM model handle.",
              model: "big-pickle",
              upstream_error: "insufficient balance on z.ai account",
            },
          },
        },
        expectedType: "abort",
        expectedRetryable: false,
      },
      {
        label: "structured terminal_quota_exhausted detail taking precedence over ModelNotFoundError wrapper",
        error: {
          name: "ModelNotFoundError",
          detail: {
            error: {
              type: "terminal_quota_exhausted",
              message: "Model not found due to exhausted account quota",
            },
          },
        },
        expectedType: "abort",
        expectedRetryable: false,
      },
      {
        label: "structured terminal_quota_exhausted detail with arbitrary message (e.g. Account locked)",
        error: {
          detail: {
            error: {
              type: "terminal_quota_exhausted",
              message: "Account locked",
            },
          },
        },
        expectedType: "abort",
        expectedRetryable: false,
      },
      {
        label: "explicit terminal quota message inside quota error payload",
        error: {
          name: "QuotaExceededError",
          message: "Terminal quota reached for provider model",
        },
        expectedType: "abort",
        expectedRetryable: false,
      },
      {
        label: "soft billing limit message without explicit terminal marker (treats as retryable quota_exceeded)",
        error: {
          name: "BillingError",
          message: "Billing limit reached for this month, resets tomorrow",
        },
        expectedType: "quota_exceeded",
        expectedRetryable: true,
      },
    ] as const

    for (const c of cases) {
      const type = classifyRuntimeFallbackError(c.error)
      const retryable = isRuntimeFallbackRetryableError(c.error, [429, 500, 502, 503, 504])

      expect(type, c.label).toBe(c.expectedType)
      expect(retryable, c.label).toBe(c.expectedRetryable)
    }
  })
})
