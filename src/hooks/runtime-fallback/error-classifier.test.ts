import { describe, expect, test } from "bun:test"

import { extractAutoRetrySignal, isRetryableError } from "./error-classifier"

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

  test("detects Weekly/Monthly Limit Exhausted as retryable", () => {
    //#given
    const error = {
      message: "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-03-14 09:17:47",
    }

    //#when
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(retryable).toBe(true)
  })

  test("detects 'limit exhausted' pattern as retryable", () => {
    //#given
    const error = {
      message: "Limit exhausted - please try again later",
    }

    //#when
    const retryable = isRetryableError(error, [429])

    //#then
    expect(retryable).toBe(true)
  })

  test("detects 'your limit will reset' pattern as retryable", () => {
    //#given
    const error = {
      message: "Your limit will reset after 24 hours",
    }

    //#when
    const retryable = isRetryableError(error, [429])

    //#then
    expect(retryable).toBe(true)
  })

  test("detects quota exceeded with status code 429", () => {
    //#given
    const error = {
      message: "Rate limit exceeded",
      statusCode: 429,
    }

    //#when
    const retryable = isRetryableError(error, [429, 500, 502, 503, 504])

    //#then
    expect(retryable).toBe(true)
  })
})
