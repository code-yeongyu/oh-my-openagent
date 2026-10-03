import { describe, expect, test } from "bun:test"

import { parseRetryAfterMs } from "./http"

describe("parseRetryAfterMs", () => {
  test("#given numeric seconds #when parsed #then the delay is returned in milliseconds", () => {
    // given / when / then
    expect(parseRetryAfterMs("120", 1_700_000_000_000)).toBe(120_000)
  })

  test("#given an HTTP date #when parsed #then the delay is measured from now", () => {
    // given
    const now = Date.parse("2023-11-14T22:00:00Z")

    // when / then
    expect(parseRetryAfterMs("Tue, 14 Nov 2023 22:02:00 GMT", now)).toBe(120_000)
  })

  test("#given a past or invalid value #when parsed #then no retry delay is invented", () => {
    // given
    const now = Date.parse("2023-11-14T22:00:00Z")

    // when / then
    expect(parseRetryAfterMs("Tue, 14 Nov 2023 21:59:00 GMT", now)).toBeUndefined()
    expect(parseRetryAfterMs("later", now)).toBeUndefined()
  })
})
