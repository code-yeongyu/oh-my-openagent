declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import { DEFAULT_STALE_TIMEOUT_MS } from "./constants"

describe("DEFAULT_STALE_TIMEOUT_MS", () => {
  test("uses the expected default value", () => {
    // #given
    const expectedTimeout = 360_000_000

    // #when
    const timeout = DEFAULT_STALE_TIMEOUT_MS

    // #then
    expect(timeout).toBe(expectedTimeout)
  })
})
