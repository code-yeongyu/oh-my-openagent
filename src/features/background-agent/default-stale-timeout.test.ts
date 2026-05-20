declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import { DEFAULT_STALE_TIMEOUT_MS } from "./constants"

describe("DEFAULT_STALE_TIMEOUT_MS", () => {
  test("uses a 5 minute default", () => {
    // #given
    const expectedTimeout = 5 * 60 * 1000

    // #when
    const timeout = DEFAULT_STALE_TIMEOUT_MS

    // #then
    expect(timeout).toBe(expectedTimeout)
  })
})
