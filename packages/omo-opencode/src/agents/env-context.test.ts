/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createEnvContext } from "./env-context"

describe("createEnvContext", () => {
  test("propagates the runtime timezone and locale", () => {
    // #given
    const resolved = Intl.DateTimeFormat().resolvedOptions()

    // #when
    const result = createEnvContext()

    // #then - dynamic environment values reach the generated context
    expect(result).toContain(resolved.timeZone)
    expect(result).toContain(resolved.locale)
  })

  test("does not include time with seconds precision to preserve token cache", () => {
    // #given - seconds-precision time changes every second, breaking cache on every request

    // #when
    const result = createEnvContext()

    // #then - no HH:MM:SS pattern anywhere in the output
    expect(result).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  test("does not include date or time values since OpenCode already provides them", () => {
    // #given - OpenCode's system.ts already injects date, platform, working directory

    // #when
    const result = createEnvContext()

    // #then - no date value leaks into the stable env block
    expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
