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

  test("does not classify no-available-accounts without configured message pattern", () => {
    //#given
    const info = {
      status: "No available accounts: no available accounts [retrying in 25s attempt #5]",
    }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeUndefined()
  })

  test("classifies no-available-accounts when configured message pattern is provided", () => {
    //#given
    const info = {
      status: "No available accounts: no available accounts [retrying in 25s attempt #5]",
    }

    //#when
    const signal = extractAutoRetrySignal(info, ["no\\s+available\\s+accounts?"])

    //#then
    expect(signal).toBeDefined()
  })

  test("treats configured message pattern matches as retryable errors", () => {
    //#given
    const error = {
      message: "No available accounts for provider anthropic",
    }

    //#when
    const retryable = isRetryableError(error, [429, 503, 529], ["no\\s+available\\s+accounts?"])

    //#then
    expect(retryable).toBe(true)
  })
})
