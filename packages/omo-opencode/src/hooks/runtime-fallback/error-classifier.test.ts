import { describe, expect, test } from "bun:test"

import { classifyErrorType, extractAutoRetrySignal, extractStatusCode, isRetryableError } from "./error-classifier"

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

  test("treats localized transient provider messages as retryable", () => {
    //#given
    const errors = [
      { message: "请求过于频繁，请稍后重试" },
      { message: "服务暂时不可用" },
      { message: "触发频率限制" },
    ]

    //#when
    const retryable = errors.map((error) => isRetryableError(error, [429, 503, 529]))

    //#then
    expect(retryable).toEqual([true, true, true])
  })

  test("treats nested AI SDK retryable Cloudflare timeout errors as retryable", () => {
    //#given
    const error = {
      error: {
        name: "AI_APICallError",
        statusCode: 524,
        isRetryable: true,
        responseBody: "<title>mengmota.com | 524: A timeout occurred</title>",
      },
    }

    //#when
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(retryable).toBe(true)
  })

  test("treats retryable AI SDK errors without configured status codes as retryable", () => {
    //#given
    const error = {
      data: {
        error: {
          name: "AI_APICallError",
          isRetryable: true,
          message: "connection reset before response body arrived",
        },
      },
    }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(true)
  })

  test("isRetryableError REJECTS isRetryable=true when status code is 401 Unauthorized", () => {
    //#given
    const error = { error: { statusCode: 401, isRetryable: true } }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(false)
  })

  test("isRetryableError REJECTS isRetryable=true when status code is 403 Forbidden", () => {
    //#given
    const error = { error: { statusCode: 403, isRetryable: true } }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(false)
  })

  test("isRetryableError REJECTS isRetryable=true when status code is 404 Not Found", () => {
    //#given
    const error = { error: { statusCode: 404, isRetryable: true } }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(false)
  })

  test("isRetryableError HONORS isRetryable=true when status code is 429 (rate-limit)", () => {
    //#given
    const error = { error: { statusCode: 429, isRetryable: true } }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(true)
  })

  test("isRetryableError HONORS isRetryable=true when status code is 503 (service unavailable)", () => {
    //#given
    const error = { error: { statusCode: 503, isRetryable: true } }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(true)
  })

  test("isRetryableError HONORS isRetryable=true when no status code is present (pure network error)", () => {
    //#given
    const error = { error: { isRetryable: true } }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(true)
  })

  test("isRetryableError HONORS isRetryable=true when status code is in retryOnErrors list", () => {
    //#given
    const error = { error: { statusCode: 400, isRetryable: true } }

    //#when
    const retryable = isRetryableError(error, [400, 429, 503, 529])

    //#then
    expect(retryable).toBe(true)
  })

  test("ignores malformed retryable flags on otherwise non-retryable errors", () => {
    //#given
    const error = {
      error: {
        name: "AI_APICallError",
        statusCode: 400,
        isRetryable: "true",
        message: "Invalid request payload",
      },
    }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529])

    //#then
    expect(retryable).toBe(false)
  })

  test("classifies localized quota exhaustion messages as quota_exceeded", () => {
    //#given
    const errors = [
      { message: "已达到 5 小时的使用上限" },
      { message: "已达到每日调用限制" },
      { message: "额度不足" },
      { message: "账户余额不足" },
      { message: "免费额度已耗尽" },
    ]

    //#when
    const classifications = errors.map((error) => classifyErrorType(error))

    //#then
    expect(classifications).toEqual([
      "quota_exceeded",
      "quota_exceeded",
      "quota_exceeded",
      "quota_exceeded",
      "quota_exceeded",
    ])
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

describe("empty output fallback", () => {
  test("detects empty_output errors as retryable for fallback chain", () => {
    //#given
    const error1 = { message: "empty output" }
    const error2 = { name: "EmptyOutputError", message: "no text output" }

    //#when
    const type1 = classifyErrorType(error1)
    const type2 = classifyErrorType(error2)
    const retryable1 = isRetryableError(error1, [])
    const retryable2 = isRetryableError(error2, [])

    //#then
    expect(type1).toBe("empty_output")
    expect(type2).toBe("empty_output")
    expect(retryable1).toBe(true)
    expect(retryable2).toBe(true)
  })
})

describe("OpenCode Go/Zen error classification", () => {
  test("classifies insufficient_quota via code field as quota_exceeded", () => {
    //#given
    const error = {
      error: {
        code: "insufficient_quota",
        type: "insufficient_quota",
        message: "You exceeded your current quota, please check your plan and billing details."
      }
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })

  test("classifies Zen CreditsError via type field as quota_exceeded", () => {
    //#given
    const error = {
      type: "error",
      error: {
        type: "CreditsError",
        message: "Insufficient balance. Manage your billing here: https://opencode.ai/workspace/..."
      }
    }

    //#when
    const errorType = classifyErrorType(error)
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(errorType).toBe("quota_exceeded")
    expect(retryable).toBe(true)
  })

})
