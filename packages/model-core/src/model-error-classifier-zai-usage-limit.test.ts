import { describe, expect, test } from "bun:test"
import { shouldRetryError } from "./model-error-classifier"

describe("model-error-classifier Z.ai rolling usage limit", () => {
  test("treats Z.ai rolling 5-hour usage limit as retryable so fallback fires", () => {
    //#given
    const error = {
      name: "AI_APICallError",
      message:
        "Usage limit reached for 5 hour. Your limit will reset at 2026-07-26 20:10:18",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats rolling minute-window usage limits as retryable", () => {
    //#given
    const error = {
      name: "AI_APICallError",
      message:
        "Usage limit reached for 30 minutes. Your limit will reset at 2026-07-26 16:00:00",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("keeps monthly usage caps as non-retryable STOP errors", () => {
    //#given
    const error = {
      name: "AI_APICallError",
      message: "Usage limit reached for this month",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("keeps permanent billing errors like insufficient balance as STOP", () => {
    //#given
    const error = {
      name: "AI_APICallError",
      message: "insufficient balance",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })
})
