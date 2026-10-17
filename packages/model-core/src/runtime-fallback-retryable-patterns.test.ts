import { describe, expect, test } from "bun:test"

import { RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS } from "./runtime-fallback-retryable-patterns"

function matches(message: string): boolean {
  return RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

describe("runtime fallback retryable patterns", () => {
  test("#given quota and service-unavailable provider messages #when matched #then they are retryable", () => {
    // given
    const messages = [
      "Free usage exceeded, subscribe to Go",
      "Streaming response failed: [503] The request queue is full.",
      '{"message":"Streaming response failed: [503] The request queue is full.","type":"server_error","param":null}',
      "Upstream request failed: Endpoint is unavailable.",
    ]

    // when
    const results = messages.map(matches)

    // then
    expect(results).toEqual([true, true, true, true])
  })
})
