/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getStoppedSessionError } from "./session-stopped-on-error"

const RATE_LIMIT_ERROR = {
  name: "APIError",
  data: { message: "Rate limit reached for requests", statusCode: 429, isRetryable: true },
}

describe("getStoppedSessionError", () => {
  test("#given the latest message is an errored assistant turn #when read #then returns the error name and message", () => {
    // given
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant", error: RATE_LIMIT_ERROR } },
    ]

    // when
    const result = getStoppedSessionError(messages)

    // then
    expect(result).toBe("APIError: Rate limit reached for requests")
  })

  test("#given a recovery prompt after the errored turn #when read #then the session is not stopped", () => {
    // given
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant", error: RATE_LIMIT_ERROR } },
      { info: { role: "user" } },
    ]

    // when
    const result = getStoppedSessionError(messages)

    // then
    expect(result).toBeUndefined()
  })

  test("#given the latest assistant turn has no error #when read #then the session is not stopped", () => {
    // given
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" } },
    ]

    // when
    const result = getStoppedSessionError(messages)

    // then
    expect(result).toBeUndefined()
  })

  test("#given an error without a data message #when read #then falls back to the top-level fields", () => {
    // given
    const messages = [{ info: { role: "assistant", error: { name: "UnknownError", message: "socket hang up" } } }]

    // when
    const result = getStoppedSessionError(messages)

    // then
    expect(result).toBe("UnknownError: socket hang up")
  })

  test("#given no messages #when read #then the session is not stopped", () => {
    // given
    const messages: Array<{ info?: { role?: string; error?: unknown } }> = []

    // when
    const result = getStoppedSessionError(messages)

    // then
    expect(result).toBeUndefined()
  })
})
