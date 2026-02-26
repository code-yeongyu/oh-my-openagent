/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createEnvContext } from "./env-context"

describe("createEnvContext", () => {
  test("returns omo-env block with timezone and locale", () => {
    // #given - no setup needed

    // #when
    const result = createEnvContext()

    // #then
    expect(result).toContain("<omo-env>")
    expect(result).toContain("</omo-env>")
    expect(result).toContain("Timezone:")
    expect(result).toContain("Locale:")
    expect(result).not.toContain("Current date:")
  })

  test("does not include time with seconds precision to preserve token cache", () => {
    // #given - seconds-precision time changes every second, breaking cache on every request

    // #when
    const result = createEnvContext()

    // #then - no HH:MM:SS pattern anywhere in the output
    expect(result).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  test("does not include date or time fields since OpenCode already provides them", () => {
    // #given - OpenCode's system.ts already injects date, platform, working directory

    // #when
    const result = createEnvContext()

    // #then - only timezone and locale remain; both are stable across requests
    expect(result).not.toContain("Current date:")
    expect(result).not.toContain("Current time:")
  })
})
