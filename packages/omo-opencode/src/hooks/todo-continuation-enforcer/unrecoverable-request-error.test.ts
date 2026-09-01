import { describe, expect, it } from "bun:test"

import { isUnrecoverableRequestError } from "./unrecoverable-request-error"

const COMPACTION_TOOL_PAIR_400 = {
  name: "APIError",
  data: {
    message:
      "messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01PCXjcagoMAca32awicQHce. Each `tool_use` block must have a corresponding `tool_result` block in the next message.",
    statusCode: 400,
    isRetryable: false,
  },
}

describe("isUnrecoverableRequestError", () => {
  describe("#given the Anthropic compaction tool_use/tool_result 400", () => {
    it("#then it is classified as unrecoverable", () => {
      // given / when / then
      expect(isUnrecoverableRequestError(COMPACTION_TOOL_PAIR_400)).toBe(true)
    })
  })

  describe("#given a retryable provider error", () => {
    it("#then it is not classified as unrecoverable", () => {
      // given
      const error = { name: "APIError", data: { message: "overloaded", statusCode: 529, isRetryable: true } }

      // when / then
      expect(isUnrecoverableRequestError(error)).toBe(false)
    })
  })

  describe("#given a 400 with no explicit retryable signal", () => {
    it("#then it is left alone so only provider-confirmed dead ends stop the loop", () => {
      // given
      const error = { name: "APIError", data: { message: "bad request", statusCode: 400 } }

      // when / then
      expect(isUnrecoverableRequestError(error)).toBe(false)
    })
  })

  describe("#given a non-retryable error with a retryable status code", () => {
    it("#then it is not classified as unrecoverable", () => {
      // given
      const error = { name: "APIError", data: { message: "rate limited", statusCode: 429, isRetryable: false } }

      // when / then
      expect(isUnrecoverableRequestError(error)).toBe(false)
    })
  })

  describe("#given a 422 unprocessable request the provider marked final", () => {
    it("#then it is classified as unrecoverable", () => {
      // given
      const error = { statusCode: 422, isRetryable: false }

      // when / then
      expect(isUnrecoverableRequestError(error)).toBe(true)
    })
  })

  describe("#given empty or shapeless input", () => {
    it("#then it is not classified as unrecoverable", () => {
      // given / when / then
      expect(isUnrecoverableRequestError(undefined)).toBe(false)
      expect(isUnrecoverableRequestError(null)).toBe(false)
      expect(isUnrecoverableRequestError("boom")).toBe(false)
      expect(isUnrecoverableRequestError({ name: "MessageAbortedError" })).toBe(false)
    })
  })
})
