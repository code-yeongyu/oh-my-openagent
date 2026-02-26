/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createEnvContext } from "./env-context"

describe("createEnvContext", () => {
  test("returns omo-env block with date, timezone, and locale", () => {
    // #given - no setup needed

    // #when
    const result = createEnvContext()

    // #then
    expect(result).toContain("<omo-env>")
    expect(result).toContain("</omo-env>")
    expect(result).toContain("Current date:")
    expect(result).toContain("Timezone:")
    expect(result).toContain("Locale:")
  })

  test("does not include time with seconds precision to preserve token cache", () => {
    // #given - seconds-precision time changes every second, breaking cache on every request

    // #when
    const result = createEnvContext()

    // #then - no HH:MM:SS pattern anywhere in the output
    expect(result).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  test("does not include Current time field", () => {
    // #given - time field (even without seconds) changes every minute, degrading cache

    // #when
    const result = createEnvContext()

    // #then - time field entirely removed; date-level precision is sufficient
    expect(result).not.toContain("Current time:")
  })
})
