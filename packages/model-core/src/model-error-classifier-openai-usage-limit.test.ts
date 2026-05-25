import { describe, expect, test } from "bun:test"
import { shouldRetryError } from "./model-error-classifier"

describe("model-error-classifier OpenAI usage_limit_reached", () => {
  test("treats OpenAI usage_limit_reached response bodies as retryable provider exhaustion", () => {
    //#given
    const error = {
      name: "AI_APICallError",
      message: '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached"}}',
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })
})
